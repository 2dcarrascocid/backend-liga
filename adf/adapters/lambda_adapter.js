/**
 * ADF - Lambda Adapter (Integration Layer)
 *
 * Convierte eventos de AWS Lambda al formato Task del ADF y
 * convierte TaskResult al formato de respuesta HTTP de Lambda.
 *
 * También provee `withADF()`: un wrapper que integra un handler Lambda
 * existente con el ADF sin modificar el handler original.
 *
 * DO:
 *   - Extraer API key del header x-api-key (case-insensitive)
 *   - Extraer Bearer token del header Authorization
 *   - Incluir requestId de AWS en task.meta para trazabilidad
 *   - Retornar statusCode HTTP correcto según el error code del TaskResult
 *
 * DON'T:
 *   - No exponer artifacts completos en respuestas de producción
 *   - No exponer stack traces en respuestas HTTP
 *   - No modificar el handler original cuando se usa withADF()
 */

import { createTask } from '../contracts/task_schema.js';
import { adf } from '../index.js';

const ERROR_HTTP_MAP = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  VALIDATION_FAILED: 400,
  SKILL_CONTRACT_ERROR: 400,
  NOT_FOUND: 404,
  PLAYER_NOT_FOUND: 404,
  CLUB_NOT_FOUND: 404,
  LOAN_NOT_FOUND: 404,
  DUPLICATE_NATIONAL_ID: 409,
  BUSINESS_RULE_FAILED: 422,
  INVALID_TRANSITION: 422,
  MAX_ROSTER_SIZE: 422,
  PLAYER_NOT_ACTIVE_IN_CLUB: 422,
  DOCUMENT_NOT_FOUND: 404,
  REGISTER_DOCUMENT_FAILED: 500,
  DELETE_DOCUMENT_FAILED: 404,
  REFEREE_NOT_FOUND: 404,
  VENUE_NOT_FOUND: 404,
  TOURNAMENT_NOT_FOUND: 404,
  STAGE_NOT_FOUND: 404,
  MATCHDAY_NOT_FOUND: 404,
  MATCH_NOT_FOUND: 404,
  EVENT_NOT_FOUND: 404,
  COST_NOT_FOUND: 404,
  SERIES_NOT_FOUND: 404,
  ROSTER_NOT_FOUND: 404,
  PLAYER_NOT_IN_CLUB: 422,
  AGE_NOT_ELIGIBLE: 422,
  ALREADY_CLUB_ADMIN_ELSEWHERE: 409,
  PENDING_INVITE_ELSEWHERE: 409,
  MISSING_FIELDS: 400,
  MISSING_ORG: 400,
  INVALID_FORMAT: 400,
  INVALID_NEXT_TOKEN: 400,
  NO_FIELDS: 400,
  DUPLICATE_TEAM: 409,
  FIXTURE_ALREADY_GENERATED: 409,
  NOT_ENOUGH_TEAMS: 422,
  MATCH_NOT_READY: 422,
  STANDINGS_EMPTY: 422,
  // Inscripción de club/serie a torneo (T-20260825-113906)
  TOURNAMENT_NOT_OPEN: 422,
  SEASON_NOT_ACTIVE: 422,
  CLUB_NOT_REGISTERED: 422,
  CATEGORY_MISMATCH: 422,
  CLUB_ORG_MISMATCH: 403,
  DUPLICATE_CLUB_REGISTRATION: 409,
  CLUB_HAS_REGISTERED_TEAMS: 409,
  INVALID_INSCRIPTION_FEE: 400,
};

/**
 * Extrae los headers relevantes de un evento Lambda (case-insensitive).
 */
export function extractHeaders(event) {
  const headers = event.headers || {};
  const lower = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
  );

  const apiKey = lower['x-api-key'] || lower['x-api-key'] || null;
  const authHeader = lower['authorization'] || '';
  const bearerToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : null;

  return { apiKey, bearerToken };
}

/**
 * Extrae metadatos de contexto del evento Lambda.
 */
export function extractMeta(event, context) {
  return {
    requestId: context?.awsRequestId || null,
    ip: event.requestContext?.http?.sourceIp || null,
    userAgent: event.requestContext?.http?.userAgent || null,
    httpMethod: event.requestContext?.http?.method || event.httpMethod || null,
    path: event.requestContext?.http?.path || event.path || null,
  };
}

/**
 * Determina el HTTP status code apropiado para un TaskResult fallido.
 */
export function resolveStatusCode(errorCode) {
  return ERROR_HTTP_MAP[errorCode] || 500;
}

/**
 * Convierte un TaskResult al formato de respuesta Lambda HTTP.
 *
 * En producción: nunca exponer trace ni artifacts completos.
 * En desarrollo (ADF_DEBUG=true): incluir trace en la respuesta.
 */
export function taskResultToLambdaResponse(taskResult) {
  const debug = process.env.ADF_DEBUG === 'true';

  if (taskResult.success) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        data: taskResult.data,
        ...(debug ? { _trace: taskResult.trace, _artifacts: taskResult.artifacts } : {}),
      }),
    };
  }

  const statusCode = resolveStatusCode(taskResult.error?.code);

  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      success: false,
      error: {
        code: taskResult.error?.code,
        message: taskResult.error?.message,
        details: taskResult.error?.details,
      },
      ...(debug ? { _trace: taskResult.trace } : {}),
    }),
  };
}

/**
 * Crea una Task ADF a partir de un evento Lambda y parámetros adicionales.
 *
 * @param {Object} params
 * @param {string}   params.type      - Tipo de operación ADF
 * @param {string}   params.domain    - Dominio ADF
 * @param {Object}   params.input     - Datos de entrada para la task
 * @param {Object}   params.event     - Evento Lambda
 * @param {Object}   params.context   - Contexto Lambda
 */
export function buildTask({ type, domain, input, event, context }) {
  const meta = extractMeta(event, context);
  return createTask({ type, domain, input, meta });
}

/**
 * withADF() — Wrapper para integrar handlers Lambda existentes con el ADF.
 *
 * Propósito: Proporciona validación de seguridad, logging y trazabilidad
 * automática a cualquier handler existente SIN modificar su lógica interna.
 *
 * Uso:
 *   export const handler = withADF('CREATE_PLAYER', 'players', async (event, context, authCtx) => {
 *     // authCtx.userId, authCtx.db disponibles automáticamente
 *     const body = JSON.parse(event.body || '{}');
 *     // ... lógica existente del handler
 *   });
 *
 * @param {string}   taskType    - Tipo de operación (para validación y logging)
 * @param {string}   domain      - Dominio ADF
 * @param {Function} handler     - Handler Lambda original
 */
export function withADF(taskType, domain, handler) {
  return async (event, context) => {
    const { apiKey, bearerToken } = extractHeaders(event);
    const meta = extractMeta(event, context);
    const { supabase, db } = adf.getRuntime();

    // Validate security only (minimal ADF integration for existing handlers)
    const secTask = {
      taskId: `${context?.awsRequestId || 'local'}-sec`,
      input: {
        apiKey,
        bearerToken,
        requireAuth: !['LOGIN_LOCAL', 'LOGIN_GOOGLE', 'LOGIN_FACEBOOK'].includes(taskType),
        supabase,
      },
    };

    const secResult = await adf.validators.security.execute(secTask);

    if (!secResult.success || !secResult.data?.authorized) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: { code: 'UNAUTHORIZED', message: 'Acceso no autorizado' } }),
      };
    }

    const authCtx = {
      userId: secResult.data.userId,
      supabase,
      db,
      apiKey,
      bearerToken,
      meta: { ...meta, taskType, domain },
    };

    // Execute original handler with auth context
    return handler(event, context, authCtx);
  };
}
