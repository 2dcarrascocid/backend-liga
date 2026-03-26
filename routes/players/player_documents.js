/**
 * Handler - Player Documents
 *
 * Los archivos se suben directo a Cloudinary desde el frontend.
 * El backend solo gestiona metadatos en lg_player_documents.
 *
 * Endpoints:
 *   GET    /players/{playerId}/documents
 *   POST   /players/{playerId}/documents
 *   GET    /players/{playerId}/documents/{documentId}
 *   DELETE /players/{playerId}/documents/{documentId}
 */

import { adf, buildTask, extractHeaders, taskResultToLambdaResponse } from '../../adf/index.js';

// GET /players/{playerId}/documents
export async function listDocuments(event, context) {
  const { playerId } = event.pathParameters || {};
  const { apiKey, bearerToken } = extractHeaders(event);

  const task = buildTask({
    type: 'LIST_DOCUMENTS',
    domain: 'player_documents',
    input: { playerId },
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

// POST /players/{playerId}/documents
export async function registerDocument(event, context) {
  const { playerId } = event.pathParameters || {};
  const body = JSON.parse(event.body || '{}');
  const { apiKey, bearerToken } = extractHeaders(event);

  const task = buildTask({
    type: 'REGISTER_DOCUMENT',
    domain: 'player_documents',
    input: {
      playerId,
      nombreOriginal: body.nombre_original,
      mimeType:       body.mime_type,
      size:           body.size,
      path:           body.path,
      bucket:         body.bucket,
      urlPublica:     body.url_publica,
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

// GET /players/{playerId}/documents/{documentId}
export async function getDocument(event, context) {
  const { playerId, documentId } = event.pathParameters || {};
  const { apiKey, bearerToken } = extractHeaders(event);

  const task = buildTask({
    type: 'GET_DOCUMENT',
    domain: 'player_documents',
    input: { playerId, documentId },
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

// DELETE /players/{playerId}/documents/{documentId}
export async function deleteDocument(event, context) {
  const { playerId, documentId } = event.pathParameters || {};
  const { apiKey, bearerToken } = extractHeaders(event);

  const task = buildTask({
    type: 'DELETE_DOCUMENT',
    domain: 'player_documents',
    input: { playerId, documentId },
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
