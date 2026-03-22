/**
 * ADF - Artifact Logger (Observability Layer)
 *
 * Registra evidencia estructurada de cada paso de ejecución:
 * inputs, outputs, decisiones, errores, métricas.
 *
 * DO:
 *   - Loggear artifacts en todas las fases de ejecución
 *   - Incluir skillName, taskId, y timestamp en cada artifact
 *   - Sanitizar datos sensibles (tokens, passwords) antes de loggear
 *
 * DON'T:
 *   - Escribir contraseñas, tokens JWT, o claves de API en los artifacts
 *   - Asumir que el logger tiene estado entre Lambdas (es stateless por invocación)
 *   - Usar console.log directamente en skills — usar este logger
 */

import { randomUUID } from 'crypto';
import { ArtifactType } from '../contracts/task_schema.js';

const SENSITIVE_KEYS = new Set([
  'password', 'token', 'accessToken', 'refreshToken', 'access_token', 'refresh_token',
  'apiKey', 'api_key', 'serviceRoleKey', 'secret', 'authorization',
]);

/**
 * Elimina campos sensibles de un objeto antes de loggear.
 */
function sanitize(obj, depth = 0) {
  if (depth > 5 || obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(i => sanitize(i, depth + 1));

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key)) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = sanitize(value, depth + 1);
    }
  }
  return result;
}

export class ArtifactLogger {
  constructor(taskId) {
    this.taskId = taskId;
    this._artifacts = [];
    this._debug = process.env.ADF_DEBUG === 'true';
  }

  /**
   * Registra un artifact.
   *
   * @param {string} type       - ArtifactType.*
   * @param {any}    data       - Datos a registrar (serán sanitizados)
   * @param {string} skillName  - Nombre de la skill que generó el artifact
   * @returns {Object} artifact creado
   */
  log(type, data, skillName) {
    const artifact = {
      artifactId: randomUUID(),
      taskId: this.taskId,
      type,
      skillName,
      data: sanitize(data),
      timestamp: new Date().toISOString(),
    };

    this._artifacts.push(artifact);

    if (this._debug) {
      console.log(
        JSON.stringify({ '[ADF:ARTIFACT]': artifact })
      );
    }

    return artifact;
  }

  logInput(data, skillName) {
    return this.log(ArtifactType.INPUT, data, skillName);
  }

  logOutput(data, skillName) {
    return this.log(ArtifactType.OUTPUT, data, skillName);
  }

  logDecision(data, skillName) {
    return this.log(ArtifactType.DECISION, data, skillName);
  }

  logValidation(data, skillName) {
    return this.log(ArtifactType.VALIDATION, data, skillName);
  }

  logError(error, skillName) {
    return this.log(ArtifactType.ERROR, {
      message: error.message || String(error),
      code: error.code,
      details: error.details,
      stack: this._debug ? error.stack : undefined,
    }, skillName);
  }

  logMetric(data, skillName) {
    return this.log(ArtifactType.METRIC, data, skillName);
  }

  logAudit(data, skillName) {
    return this.log(ArtifactType.AUDIT, data, skillName);
  }

  /**
   * Retorna todos los artifacts registrados (para incluir en TaskResult).
   */
  getAll() {
    return [...this._artifacts];
  }

  /**
   * Genera un resumen de los artifacts para incluir en respuestas de producción.
   * Nunca exponer los datos completos en respuestas HTTP.
   */
  getSummary() {
    return this._artifacts.map(a => ({
      artifactId: a.artifactId,
      type: a.type,
      skillName: a.skillName,
      timestamp: a.timestamp,
    }));
  }
}
