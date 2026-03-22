/**
 * ADF - Ejemplo: Handler de Préstamos usando el Orchestrator completo
 *
 * Este archivo muestra cómo un NUEVO handler Lambda puede aprovechar
 * el ADF al 100%: validación, seguridad, ejecución y trazabilidad.
 *
 * Los handlers EXISTENTES (routes/) no necesitan cambiar — este es
 * el patrón para los nuevos que se desarrollen a futuro.
 */

import { adf, createTask, buildTask, extractHeaders, taskResultToLambdaResponse } from '../index.js';

// ── REQUEST: POST /loans ───────────────────────────────────────────────────────
export async function requestLoan(event, context) {
  const body = JSON.parse(event.body || '{}');
  const { apiKey, bearerToken } = extractHeaders(event);

  const task = buildTask({
    type: 'REQUEST_LOAN',
    domain: 'loans',
    input: {
      orgId: body.orgId,
      playerId: body.playerId,
      fromClubId: body.fromClubId,
      toClubId: body.toClubId,
      loanType: body.loanType,
      startDate: body.startDate,
      endDate: body.endDate,
    },
    event,
    context,
  });

  const result = await adf.orchestrator.execute(task, {
    apiKey,
    bearerToken,
    ...adf.getRuntime(),
  });

  return taskResultToLambdaResponse(result);
}

// ── APPROVE: PATCH /loans/{loanId}/approve ────────────────────────────────────
export async function approveLoan(event, context) {
  const { loanId } = event.pathParameters || {};
  const { apiKey, bearerToken } = extractHeaders(event);

  const task = buildTask({
    type: 'APPROVE_LOAN',
    domain: 'loans',
    input: { loanId },
    event,
    context,
  });

  const result = await adf.orchestrator.execute(task, {
    apiKey,
    bearerToken,
    ...adf.getRuntime(),
  });

  return taskResultToLambdaResponse(result);
}

// ── REJECT: PATCH /loans/{loanId}/reject ──────────────────────────────────────
export async function rejectLoan(event, context) {
  const { loanId } = event.pathParameters || {};
  const { apiKey, bearerToken } = extractHeaders(event);

  const task = buildTask({
    type: 'REJECT_LOAN',
    domain: 'loans',
    input: { loanId },
    event,
    context,
  });

  const result = await adf.orchestrator.execute(task, {
    apiKey,
    bearerToken,
    ...adf.getRuntime(),
  });

  return taskResultToLambdaResponse(result);
}

// ── RETURN: PATCH /loans/{loanId}/return ──────────────────────────────────────
export async function returnLoan(event, context) {
  const { loanId } = event.pathParameters || {};
  const { apiKey, bearerToken } = extractHeaders(event);

  const task = buildTask({
    type: 'RETURN_LOAN',
    domain: 'loans',
    input: { loanId },
    event,
    context,
  });

  const result = await adf.orchestrator.execute(task, {
    apiKey,
    bearerToken,
    ...adf.getRuntime(),
  });

  return taskResultToLambdaResponse(result);
}

// ── LIST: GET /loans ───────────────────────────────────────────────────────────
export async function listLoans(event, context) {
  const qp = event.queryStringParameters || {};
  const { apiKey, bearerToken } = extractHeaders(event);

  const task = buildTask({
    type: 'LIST_LOANS',
    domain: 'loans',
    input: {
      orgId: qp.orgId,
      status: qp.status,
      playerId: qp.playerId,
    },
    event,
    context,
  });

  const result = await adf.orchestrator.execute(task, {
    apiKey,
    bearerToken,
    ...adf.getRuntime(),
  });

  return taskResultToLambdaResponse(result);
}
