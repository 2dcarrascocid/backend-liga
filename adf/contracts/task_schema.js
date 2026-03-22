/**
 * ADF - Task Schema
 * Define la estructura estándar de Task y TaskResult que fluye por todo el sistema.
 * Ninguna skill debe inventar su propio formato de entrada/salida.
 */

import { randomUUID } from 'crypto';

export const TaskStatus = Object.freeze({
  PENDING: 'PENDING',
  PLANNING: 'PLANNING',
  VALIDATING: 'VALIDATING',
  EXECUTING: 'EXECUTING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  ABORTED: 'ABORTED',
});

export const ArtifactType = Object.freeze({
  INPUT: 'INPUT',
  OUTPUT: 'OUTPUT',
  DECISION: 'DECISION',
  VALIDATION: 'VALIDATION',
  ERROR: 'ERROR',
  METRIC: 'METRIC',
  AUDIT: 'AUDIT',
});

/**
 * Crea una Task estándar para el orchestrator.
 *
 * @param {Object} params
 * @param {string} params.type      - Operación a ejecutar (CREATE_PLAYER, LOGIN_LOCAL, etc.)
 * @param {string} params.domain    - Dominio de negocio (auth, clubs, players, loans)
 * @param {Object} params.input     - Datos de entrada para la skill
 * @param {Object} [params.meta]    - Metadatos de contexto (requestId, userId, ip, etc.)
 * @returns {Task}
 */
export function createTask({ type, domain, input, meta = {} }) {
  if (!type) throw new Error('Task requires a type');
  if (!domain) throw new Error('Task requires a domain');
  if (!input || typeof input !== 'object') throw new Error('Task requires an input object');

  return {
    taskId: randomUUID(),
    type,
    domain,
    status: TaskStatus.PENDING,
    input,
    output: null,
    artifacts: [],
    trace: [],
    meta: {
      requestId: meta.requestId || randomUUID(),
      userId: meta.userId || null,
      ip: meta.ip || null,
      userAgent: meta.userAgent || null,
      timestamp: new Date().toISOString(),
      ...meta,
    },
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
}

/**
 * Crea el resultado final de una Task.
 *
 * @param {Object} params
 * @param {boolean}  params.success
 * @param {any}      [params.data]
 * @param {Object}   [params.error]   - { code, message, details }
 * @param {Array}    [params.artifacts]
 * @param {Object}   [params.trace]
 * @returns {TaskResult}
 */
export function createTaskResult({ success, data = null, error = null, artifacts = [], trace = {} }) {
  return {
    success,
    data,
    error,
    artifacts,
    trace,
    completedAt: new Date().toISOString(),
  };
}

/**
 * Resultado estándar que devuelve cada Skill.
 *
 * @param {Object} params
 * @param {boolean}  params.success
 * @param {any}      [params.data]
 * @param {string}   [params.errorCode]
 * @param {string}   [params.errorMessage]
 * @param {Array}    [params.errorDetails]
 */
export function createSkillResult({ success, data = null, errorCode = null, errorMessage = null, errorDetails = null }) {
  return {
    success,
    data,
    error: success ? null : {
      code: errorCode,
      message: errorMessage,
      details: errorDetails,
    },
  };
}
