/**
 * ADF - Trace Builder (Observability Layer)
 *
 * Registra la secuencia de pasos de ejecución para trazabilidad completa.
 * Cada step indica qué skill ejecutó, cuánto tardó, y si tuvo éxito.
 *
 * DO:
 *   - Agregar un step al iniciar y al finalizar cada skill
 *   - Incluir la duración real de cada step
 *   - Registrar el reason cuando un step falla o se omite
 *
 * DON'T:
 *   - Incluir datos sensibles en los steps del trace
 *   - Llamar addStep() sin el skillName correspondiente
 */

export const StepStatus = Object.freeze({
  STARTED: 'STARTED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
});

export class TraceBuilder {
  constructor(taskId) {
    if (!taskId) throw new Error('TraceBuilder requires a taskId');
    this.taskId = taskId;
    this._steps = [];
    this._globalStart = Date.now();
    this._stepStarts = new Map();
  }

  /**
   * Marca el inicio de un step y retorna el stepId.
   * @param {string} skillName
   * @param {Object} [meta]
   * @returns {string} stepId
   */
  startStep(skillName, meta = {}) {
    const stepId = `${skillName}:${this._steps.length + 1}`;
    this._stepStarts.set(stepId, Date.now());

    this._steps.push({
      stepId,
      skillName,
      status: StepStatus.STARTED,
      durationMs: null,
      offsetMs: Date.now() - this._globalStart,
      meta,
      timestamp: new Date().toISOString(),
    });

    return stepId;
  }

  /**
   * Marca un step como completado, fallado, u omitido.
   * @param {string} stepId         - ID retornado por startStep()
   * @param {string} status         - StepStatus.*
   * @param {Object} [meta]         - Contexto adicional (error, reason, etc.)
   */
  endStep(stepId, status, meta = {}) {
    const step = this._steps.find(s => s.stepId === stepId);
    if (!step) return;

    const startTime = this._stepStarts.get(stepId);
    step.status = status;
    step.durationMs = startTime ? Date.now() - startTime : null;
    step.meta = { ...step.meta, ...meta };
    this._stepStarts.delete(stepId);
  }

  /**
   * Shortcut: registra un step completo en un solo llamado (para steps instantáneos).
   */
  addStep(skillName, status, meta = {}) {
    const stepId = this.startStep(skillName, meta);
    this.endStep(stepId, status, meta);
    return stepId;
  }

  /**
   * Construye el objeto de trace final para incluir en TaskResult.
   */
  build() {
    return {
      taskId: this.taskId,
      totalDurationMs: Date.now() - this._globalStart,
      stepCount: this._steps.length,
      steps: this._steps,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Indica si algún step falló.
   */
  hasFailed() {
    return this._steps.some(s => s.status === StepStatus.FAILED);
  }
}
