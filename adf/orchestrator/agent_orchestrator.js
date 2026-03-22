/**
 * ADF - Agent Orchestrator (Orchestrator Layer)
 *
 * Cerebro del sistema ADF. Recibe una Task y coordina la ejecución completa:
 *
 *   1. PLANNING    — determina qué validators y specialist se necesitan
 *   2. VALIDATING  — ejecuta security_validator y request_validator
 *   3. EXECUTING   — llama al Specialist del dominio correspondiente
 *   4. FINALIZING  — registra artifacts y construye el trace completo
 *
 * DO:
 *   - Pasar por validación de seguridad en TODOS los requests
 *   - Pasar por request_validator antes de llamar al Specialist
 *   - Registrar artifacts en cada fase
 *   - Retornar siempre un TaskResult estructurado
 *
 * DON'T:
 *   - No ejecutar lógica de negocio directamente — delegar a Specialists
 *   - No saltar la fase de validación por ningún motivo
 *   - No exponer artifacts completos en respuestas HTTP (solo summary)
 *   - No asumir que el Specialist no falla — siempre manejar error
 *
 * Checklist de ejecución:
 *   [ ] SecurityValidator ejecutado antes de cualquier otra cosa
 *   [ ] RequestValidator ejecutado con las reglas del dominio
 *   [ ] Specialist correcto seleccionado por domain + type
 *   [ ] Artifact de DECISION registrado con el plan
 *   [ ] Trace completo con duración de cada step
 *   [ ] TaskResult retornado con success/data/error/artifacts/trace
 */

import { TaskStatus, createTaskResult } from '../contracts/task_schema.js';
import { ArtifactLogger } from '../observability/artifact_logger.js';
import { TraceBuilder, StepStatus } from '../observability/trace_builder.js';
import { ValidationRules } from '../validators/request_validator.js';

export class AgentOrchestrator {
  /**
   * @param {Object} config
   * @param {Object} config.specialists  - Map<domain, Skill>
   * @param {Object} config.validators   - { request, security, business }
   */
  constructor({ specialists, validators }) {
    if (!specialists || !validators) {
      throw new Error('AgentOrchestrator requires specialists and validators');
    }
    this.specialists = specialists;
    this.validators = validators;
  }

  /**
   * Ejecuta una Task completa a través de todas las fases ADF.
   *
   * @param {import('../contracts/task_schema.js').Task} task
   * @param {Object} [runtimeCtx]  - Contexto de runtime: { apiKey, bearerToken, supabase, db }
   * @returns {Promise<import('../contracts/task_schema.js').TaskResult>}
   */
  async execute(task, runtimeCtx = {}) {
    const logger = new ArtifactLogger(task.taskId);
    const trace = new TraceBuilder(task.taskId);

    // ── PHASE 0: PLANNING ──────────────────────────────────────────────────────
    const planStep = trace.startStep('orchestrator:planning');
    task.status = TaskStatus.PLANNING;

    const plan = this._buildPlan(task);
    logger.logDecision({ plan, task: { type: task.type, domain: task.domain } }, 'orchestrator');

    trace.endStep(planStep, StepStatus.COMPLETED, { planSteps: plan.steps.length });

    // ── PHASE 1: SECURITY VALIDATION ───────────────────────────────────────────
    const secStep = trace.startStep('security_validator');
    task.status = TaskStatus.VALIDATING;

    const secTask = {
      taskId: task.taskId,
      input: {
        apiKey: runtimeCtx.apiKey,
        bearerToken: runtimeCtx.bearerToken,
        requireAuth: plan.requireAuth,
        supabase: runtimeCtx.supabase,
      },
    };

    const secResult = await this.validators.security.execute(secTask);
    logger.logValidation({ type: 'security', result: secResult.data }, 'security_validator');

    if (!secResult.success || !secResult.data?.authorized) {
      trace.endStep(secStep, StepStatus.FAILED, { reason: secResult.error?.message });
      return createTaskResult({
        success: false,
        error: { code: 'UNAUTHORIZED', message: secResult.error?.message || 'Acceso no autorizado' },
        artifacts: logger.getSummary(),
        trace: trace.build(),
      });
    }

    trace.endStep(secStep, StepStatus.COMPLETED);
    const authenticatedUserId = secResult.data.userId;

    // ── PHASE 2: REQUEST VALIDATION ────────────────────────────────────────────
    const reqStep = trace.startStep('request_validator');

    const reqTask = {
      taskId: task.taskId,
      input: {
        fields: task.input,
        rules: plan.validationRules,
      },
    };

    const reqResult = await this.validators.request.execute(reqTask);
    logger.logValidation({ type: 'request', valid: reqResult.data?.valid, errors: reqResult.data?.errors }, 'request_validator');

    if (!reqResult.success || !reqResult.data?.valid) {
      trace.endStep(reqStep, StepStatus.FAILED, { errors: reqResult.data?.errors });
      return createTaskResult({
        success: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Error de validación en los datos de entrada',
          details: reqResult.data?.errors,
        },
        artifacts: logger.getSummary(),
        trace: trace.build(),
      });
    }

    trace.endStep(reqStep, StepStatus.COMPLETED);

    // ── PHASE 3: SPECIALIST EXECUTION ──────────────────────────────────────────
    const specialist = this.specialists[task.domain];
    if (!specialist) {
      const err = `No existe Specialist para el dominio "${task.domain}"`;
      logger.logError({ message: err }, 'orchestrator');
      return createTaskResult({
        success: false,
        error: { code: 'NO_SPECIALIST', message: err },
        artifacts: logger.getSummary(),
        trace: trace.build(),
      });
    }

    const specStep = trace.startStep(specialist.name);
    task.status = TaskStatus.EXECUTING;
    logger.logInput(task.input, specialist.name);

    const specTask = {
      taskId: task.taskId,
      input: {
        operation: task.type,
        payload: task.input,
        db: runtimeCtx.db || runtimeCtx.supabase,
        supabase: runtimeCtx.supabase,
        userId: authenticatedUserId,
      },
    };

    const specResult = await specialist.execute(specTask);
    logger.logOutput(specResult.data, specialist.name);

    if (!specResult.success) {
      logger.logError(specResult.error || {}, specialist.name);
      trace.endStep(specStep, StepStatus.FAILED, { errorCode: specResult.error?.code });
      task.status = TaskStatus.FAILED;

      return createTaskResult({
        success: false,
        error: specResult.error,
        artifacts: logger.getSummary(),
        trace: trace.build(),
      });
    }

    trace.endStep(specStep, StepStatus.COMPLETED);

    // ── PHASE 4: AUDIT LOG ─────────────────────────────────────────────────────
    logger.logAudit({
      taskType: task.type,
      domain: task.domain,
      userId: authenticatedUserId,
      success: true,
    }, 'orchestrator');

    task.status = TaskStatus.COMPLETED;
    task.completedAt = new Date().toISOString();

    return createTaskResult({
      success: true,
      data: specResult.data,
      artifacts: logger.getSummary(),
      trace: trace.build(),
    });
  }

  /**
   * Construye el plan de ejecución para una task dada.
   * El plan determina: requireAuth, validationRules, y pasos esperados.
   */
  _buildPlan(task) {
    const { type, domain } = task;

    // Endpoints que NO requieren autenticación de usuario (solo API key)
    const PUBLIC_OPERATIONS = new Set(['LOGIN_LOCAL', 'LOGIN_GOOGLE', 'LOGIN_FACEBOOK']);
    const requireAuth = !PUBLIC_OPERATIONS.has(type);

    // Obtener reglas de validación del catálogo
    const validationRules = ValidationRules[domain]?.[type] || [];

    const steps = [
      'security_validator',
      'request_validator',
      `${domain}_specialist`,
    ];

    return {
      requireAuth,
      validationRules,
      steps,
      domain,
      type,
      plannedAt: new Date().toISOString(),
    };
  }
}
