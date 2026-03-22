/**
 * ADF Health Check — Lambda handler
 * GET /adf/health
 *
 * Verifica que el ADF está activo, todos los skills registrados
 * y el orchestrator puede crear tasks correctamente.
 *
 * No requiere API key ni autenticación — solo para diagnóstico en desarrollo.
 */

import { adf, createTask } from '../../adf/index.js';

export async function handler(event) {
  try {
    const info = adf.describe();

    // Verifica que se puede crear una task
    const testTask = createTask({
      type: 'LOGIN_LOCAL',
      domain: 'auth',
      input: { email: 'health@check.local', password: 'ping' },
      meta: { requestId: 'health-check' },
    });

    // Verifica capabilities por dominio
    const capabilitiesCheck = Object.fromEntries(
      Object.entries(adf.specialists).map(([domain, specialist]) => [
        domain,
        {
          name: specialist.name,
          version: specialist.version,
          capabilities: specialist.capabilities,
          ok: Array.isArray(specialist.capabilities) && specialist.capabilities.length > 0,
        },
      ])
    );

    const validatorsCheck = Object.fromEntries(
      Object.entries(adf.validators).map(([name, validator]) => [
        name,
        { name: validator.name, version: validator.version, ok: true },
      ])
    );

    const allOk = Object.values(capabilitiesCheck).every(c => c.ok);

    return {
      statusCode: allOk ? 200 : 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: allOk ? 'ADF_ACTIVE' : 'ADF_DEGRADED',
        orchestrator: info.orchestrator,
        totalSkills: info.totalSkills,
        validators: validatorsCheck,
        specialists: capabilitiesCheck,
        taskCreation: {
          ok: !!testTask.taskId,
          taskId: testTask.taskId,
          status: testTask.status,
        },
        checkedAt: new Date().toISOString(),
      }, null, 2),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'ADF_ERROR',
        error: err.message,
        checkedAt: new Date().toISOString(),
      }),
    };
  }
}
