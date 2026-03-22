/**
 * ADF - Security Validator (Validators Layer)
 *
 * Valida API key y Bearer token. Retorna el userId verificado
 * para que el Specialist pueda ejecutar en contexto autenticado.
 *
 * DO:
 *   - Validar siempre la API key antes del Bearer token
 *   - Retornar userId verificado para trazabilidad
 *   - Registrar intentos fallidos como artifacts de auditoría
 *
 * DON'T:
 *   - Exponer el motivo exacto del fallo al cliente (evitar enumeración)
 *   - Cachear tokens entre invocaciones (Lambda es stateless)
 *   - Lanzar excepciones — retornar { authorized: false, reason }
 *
 * Checklist:
 *   [ ] ¿Se validó la API key contra process.env.API_KEY?
 *   [ ] ¿Se validó el Bearer token con Supabase?
 *   [ ] ¿Se retornó el userId del usuario autenticado?
 *   [ ] ¿Se registró el resultado (ok/fail) como artifact de auditoría?
 */

import { Skill } from '../contracts/skill_contract.js';
import { createSkillResult } from '../contracts/task_schema.js';

export class SecurityValidator extends Skill {
  constructor() {
    super('security_validator', '1.0.0');
    this.domain = 'validators';

    this.contract = {
      input: [
        { name: 'apiKey', required: true, type: 'string', description: 'API key del request' },
        { name: 'bearerToken', required: false, type: 'string', description: 'JWT del usuario autenticado' },
        { name: 'requireAuth', required: true, type: 'boolean', description: '¿Se requiere autenticación de usuario?' },
        { name: 'supabase', required: true, type: 'object', description: 'Cliente Supabase inicializado' },
      ],
      output: [
        { name: 'authorized', type: 'boolean', description: 'true si el request está autorizado' },
        { name: 'userId', type: 'string', description: 'ID del usuario autenticado (null si no aplica)' },
        { name: 'reason', type: 'string', description: 'Motivo del fallo (solo para logs internos)' },
      ],
      rules: {
        do: [
          'Validar API key en todos los requests, sin excepciones',
          'Usar supabase.auth.getUser() para verificar tokens — nunca decodificar JWT manualmente',
          'Retornar userId siempre que el token sea válido',
        ],
        dont: [
          'No exponer el motivo de fallo al cliente final',
          'No cachear resultados de validación entre invocaciones',
          'No omitir la validación de API key aunque el Bearer sea válido',
        ],
      },
      checklist: [
        'API key validada contra API_KEY env var',
        'Bearer token verificado con Supabase si requireAuth=true',
        'userId incluido en el resultado cuando el token es válido',
        'Resultado registrado como artifact de auditoría',
      ],
    };
  }

  async execute(task) {
    const { apiKey, bearerToken, requireAuth, supabase } = task.input;

    // Step 1: Validate API key
    const expectedKey = process.env.API_KEY;
    if (!expectedKey || !apiKey || apiKey !== expectedKey) {
      return createSkillResult({
        success: false,
        data: { authorized: false, userId: null },
        errorCode: 'UNAUTHORIZED',
        errorMessage: 'Acceso no autorizado',
      });
    }

    // Step 2: If endpoint doesn't require user auth, we're done
    if (!requireAuth) {
      return createSkillResult({
        success: true,
        data: { authorized: true, userId: null, reason: 'api_key_only' },
      });
    }

    // Step 3: Validate Bearer token
    if (!bearerToken) {
      return createSkillResult({
        success: false,
        data: { authorized: false, userId: null },
        errorCode: 'UNAUTHORIZED',
        errorMessage: 'Token de autenticación requerido',
      });
    }

    try {
      const { data: { user }, error } = await supabase.auth.getUser(bearerToken);

      if (error || !user) {
        return createSkillResult({
          success: false,
          data: { authorized: false, userId: null },
          errorCode: 'UNAUTHORIZED',
          errorMessage: 'Token inválido o expirado',
        });
      }

      return createSkillResult({
        success: true,
        data: { authorized: true, userId: user.id, reason: 'bearer_validated' },
      });
    } catch (err) {
      return createSkillResult({
        success: false,
        data: { authorized: false, userId: null },
        errorCode: 'UNAUTHORIZED',
        errorMessage: 'Error al validar token',
      });
    }
  }
}
