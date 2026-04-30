/**
 * handler.js — Monolithic ADF-Integrated Handler
 *
 * Single Lambda entry point. Todas las rutas pasan por el ADF Orchestrator:
 *   Security Validation → Request Validation → Specialist → Response
 *
 * Rutas especiales (no pasan por ADF):
 *   GET /adf/health  — diagnóstico del ADF sin autenticación
 */

import { adf, buildTask, extractHeaders, taskResultToLambdaResponse } from './adf/index.js'
import { handler as adfHealthHandler } from './routes/adf/health.js'
import { errorResponse } from './utils/response.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const parseBody = (event) => {
  if (!event.body) return {}
  try {
    return typeof event.body === 'string' ? JSON.parse(event.body) : event.body
  } catch {
    return {}
  }
}

/**
 * Compila un patrón de ruta como '/clubs/{clubId}/roster/{rosterId}'
 * en un regex con named groups.
 *
 * @param {string} method   - Método HTTP
 * @param {string} pattern  - Patrón de ruta
 * @param {Function} taskFn - (pathParams, body, qs, event) → { type, domain, input }
 */
function route(method, pattern, taskFn) {
  const regexStr = pattern
    .split('/')
    .filter(Boolean)
    .map((seg) => (/^\{.+\}$/.test(seg) ? `(?<${seg.slice(1, -1)}>[^/]+)` : seg))
    .join('\\/')
  return {
    method: method.toUpperCase(),
    regex: new RegExp(`^\\/${regexStr}$`),
    taskFn,
  }
}

// ─── Tabla de Rutas ──────────────────────────────────────────────────────────
//
// Firma de taskFn: (pp, body, qs, event) => { type, domain, input }
//   pp   = pathParameters (ej: { clubId, playerId })
//   body = cuerpo parseado de la request
//   qs   = queryStringParameters
//   event= evento Lambda completo (disponible si se necesita)

const ROUTES = [

  // ── Auth ──────────────────────────────────────────────────────────────────

  route('POST', '/auth/login/local', (_pp, body) => ({
    type: 'LOGIN_LOCAL', domain: 'auth',
    input: { email: body.email, password: body.password },
  })),

  route('POST', '/auth/login/google', (_pp, body) => ({
    type: 'LOGIN_GOOGLE', domain: 'auth',
    input: { idToken: body.id_token ?? body.idToken },
  })),

  route('POST', '/auth/login/facebook', (_pp, body) => ({
    type: 'LOGIN_FACEBOOK', domain: 'auth',
    input: { idToken: body.access_token ?? body.id_token ?? body.idToken },
  })),

  route('POST', '/auth/bootstrap', (_pp, body) => ({
    type: 'BOOTSTRAP', domain: 'auth',
    input: {
      orgName:     body.org_name,
      orgSlug:     body.org_slug,
      countryCode: body.country_code ?? 'CL',
    },
  })),

  // ── Clubs ─────────────────────────────────────────────────────────────────

  route('POST', '/clubs', (_pp, body) => ({
    type: 'CREATE_CLUB', domain: 'clubs',
    input: {
      orgId:       body.org_id,
      name:        body.name,
      shortName:   body.short_name,
      colors:      body.colors,
      logoUrl:     body.logo_url,
      description: body.description,
      folioStart:  body.folio_start != null ? parseInt(body.folio_start, 10) : undefined,
      folioEnd:    body.folio_end   != null ? parseInt(body.folio_end,   10) : undefined,
      maxPlayers:  body.max_players != null ? parseInt(body.max_players, 10) : 70,
    },
  })),

  route('GET', '/clubs', (_pp, _body, qs) => ({
    type: 'GET_CLUBS', domain: 'clubs',
    input: {
      orgId:     qs.org_id,
      limit:     qs.limit ? parseInt(qs.limit, 10) : 20,
      nextToken: qs.next_token,
    },
  })),

  route('GET', '/clubs/{clubId}', (pp) => ({
    type: 'GET_CLUB', domain: 'clubs',
    input: { clubId: pp.clubId },
  })),

  route('PATCH', '/clubs/{clubId}', (pp, body) => ({
    type: 'UPDATE_CLUB', domain: 'clubs',
    input: { clubId: pp.clubId, ...body },
  })),

  route('POST', '/clubs/{clubId}/users', (pp, body) => ({
    type: 'ADD_CLUB_USER', domain: 'clubs',
    input: { clubId: pp.clubId, userId: body.user_id, role: body.role ?? 'MEMBER' },
  })),

  route('DELETE', '/clubs/{clubId}/users/{userId}', (pp) => ({
    type: 'REMOVE_CLUB_USER', domain: 'clubs',
    input: { clubId: pp.clubId, userId: pp.userId },
  })),

  route('POST', '/clubs/{clubId}/roster', (pp, body) => ({
    type: 'ADD_ROSTER', domain: 'clubs',
    input: {
      clubId:    pp.clubId,
      playerId:  body.player_id,
      validFrom: body.valid_from,
      validTo:   body.valid_to,
    },
  })),

  route('GET', '/clubs/{clubId}/roster', (pp, _body, qs) => ({
    type: 'GET_ROSTER', domain: 'clubs',
    input: {
      clubId:    pp.clubId,
      limit:     qs.limit ? parseInt(qs.limit, 10) : 20,
      nextToken: qs.next_token,
      status:    qs.status,
    },
  })),

  route('PATCH', '/clubs/{clubId}/roster/{rosterId}', (pp, body) => ({
    type: 'UPDATE_ROSTER', domain: 'clubs',
    input: { rosterId: pp.rosterId, status: body.status, validTo: body.valid_to },
  })),

  // ── Players ───────────────────────────────────────────────────────────────

  route('POST', '/clubs/{clubId}/players', (pp, body) => ({
    type: 'CREATE_PLAYER', domain: 'players',
    input: {
      clubId:     pp.clubId,
      firstName:  body.first_name,
      lastName:   body.last_name,
      rut:        body.rut,
      birthDate:  body.birth_date,
      address:    body.address,
      phone:      body.phone,
      email:      body.email,
      photoUrl:   body.photo_url,
      position:   body.position,
      categoryId: body.category_id,
      clubFolio:  body.club_folio,
    },
  })),

  route('GET', '/clubs/{clubId}/players', (pp, _body, qs) => ({
    type: 'LIST_PLAYERS_BY_CLUB', domain: 'players',
    input: {
      clubId:     pp.clubId,
      q:          qs.q,
      status:     qs.status ?? 'ACTIVE',
      limit:      qs.limit ? parseInt(qs.limit, 10) : 10,
      next_token: qs.next_token,
    },
  })),

  route('PATCH', '/clubs/{clubId}/players/{playerId}/status', (pp, body) => ({
    type: 'UPDATE_STATUS', domain: 'players',
    input: { clubId: pp.clubId, playerId: pp.playerId, status: body.status },
  })),

  route('GET', '/orgs/{orgId}/players', (pp, _body, qs) => ({
    type: 'LIST_PLAYERS_BY_ORG', domain: 'players',
    input: { orgId: pp.orgId, limit: qs.limit ? parseInt(qs.limit, 10) : 50 },
  })),

  route('GET', '/players/{playerId}', (pp) => ({
    type: 'GET_PLAYER', domain: 'players',
    input: { playerId: pp.playerId },
  })),

  route('PATCH', '/players/{playerId}', (pp, body) => ({
    type: 'UPDATE_PLAYER', domain: 'players',
    input: { playerId: pp.playerId, ...body },
  })),

  route('POST', '/players/{playerId}/change-club', (pp, body) => ({
    type: 'CHANGE_CLUB', domain: 'players',
    input: {
      playerId:   pp.playerId,
      toClubId:   body.to_club_id,
      fromClubId: body.from_club_id, // opcional — si no se envía, el specialist lo resuelve
    },
  })),

  route('POST', '/players/{playerId}/photo', (pp, body) => ({
    type: 'UPLOAD_PHOTO', domain: 'players',
    input: { playerId: pp.playerId, photoUrl: body.photo_url },
  })),

  // ── Documentos de Jugador ─────────────────────────────────────────────────

  route('GET', '/players/{playerId}/documents', (pp) => ({
    type: 'LIST_DOCUMENTS', domain: 'player_documents',
    input: { playerId: pp.playerId },
  })),

  route('POST', '/players/{playerId}/documents', (pp, body) => ({
    type: 'REGISTER_DOCUMENT', domain: 'player_documents',
    input: {
      playerId:       pp.playerId,
      nombreOriginal: body.nombre_original,
      mimeType:       body.mime_type,
      size:           body.size,
      path:           body.path,
      bucket:         body.bucket,
      urlPublica:     body.url_publica,
    },
  })),

  route('GET', '/players/{playerId}/documents/{documentId}', (pp) => ({
    type: 'GET_DOCUMENT', domain: 'player_documents',
    input: { playerId: pp.playerId, documentId: pp.documentId },
  })),

  route('DELETE', '/players/{playerId}/documents/{documentId}', (pp) => ({
    type: 'DELETE_DOCUMENT', domain: 'player_documents',
    input: { playerId: pp.playerId, documentId: pp.documentId },
  })),

  // ── Categorías ────────────────────────────────────────────────────────────

  route('GET', '/clubs/{clubId}/categories', (pp) => ({
    type: 'LIST_CATEGORIES', domain: 'categories',
    input: { clubId: pp.clubId },
  })),

  route('POST', '/clubs/{clubId}/categories', (pp, body) => ({
    type: 'CREATE_CATEGORY', domain: 'categories',
    input: {
      clubId:      pp.clubId,
      name:        body.name,
      color:       body.color,
      ageFrom:     body.age_from,
      ageTo:       body.age_to,
      description: body.description,
    },
  })),

  route('PATCH', '/clubs/{clubId}/categories/{categoryId}', (pp, body) => ({
    type: 'UPDATE_CATEGORY', domain: 'categories',
    input: { clubId: pp.clubId, categoryId: pp.categoryId, ...body },
  })),

  route('DELETE', '/clubs/{clubId}/categories/{categoryId}', (pp) => ({
    type: 'DELETE_CATEGORY', domain: 'categories',
    input: { clubId: pp.clubId, categoryId: pp.categoryId },
  })),

  // ── Traspasos ─────────────────────────────────────────────────────────────

  route('GET', '/clubs/{clubId}/transfers', (pp) => ({
    type: 'LIST_TRANSFERS', domain: 'transfers',
    input: { clubId: pp.clubId },
  })),

  route('POST', '/clubs/{clubId}/transfers', (pp, body) => ({
    type: 'CREATE_TRANSFER', domain: 'transfers',
    input: {
      clubId:   pp.clubId,
      playerId: body.player_id,
      toClubId: body.to_club_id,
      notes:    body.notes,
    },
  })),

  route('PATCH', '/clubs/{clubId}/transfers/{transferId}/accept', (pp) => ({
    type: 'ACCEPT_TRANSFER', domain: 'transfers',
    input: { clubId: pp.clubId, transferId: pp.transferId },
  })),

  route('PATCH', '/clubs/{clubId}/transfers/{transferId}/reject', (pp) => ({
    type: 'REJECT_TRANSFER', domain: 'transfers',
    input: { clubId: pp.clubId, transferId: pp.transferId },
  })),

  route('DELETE', '/clubs/{clubId}/transfers/{transferId}', (pp) => ({
    type: 'CANCEL_TRANSFER', domain: 'transfers',
    input: { clubId: pp.clubId, transferId: pp.transferId },
  })),
]

// ─── Handler Principal ───────────────────────────────────────────────────────

export const handler = async (event, context) => {
  const method = (
    event.requestContext?.http?.method ??
    event.httpMethod ??
    'GET'
  ).toUpperCase()

  const path = event.rawPath ?? event.path ?? '/'

  // Ruta especial: health check del ADF (no requiere auth ni va por orchestrator)
  if (method === 'GET' && path === '/adf/health') {
    return adfHealthHandler(event, context)
  }

  const qs   = event.queryStringParameters ?? {}
  const body = parseBody(event)
  const { apiKey, bearerToken } = extractHeaders(event)

  for (const r of ROUTES) {
    if (r.method !== method) continue
    const match = path.match(r.regex)
    if (!match) continue

    const pathParams = match.groups ?? {}
    const { type, domain, input } = r.taskFn(pathParams, body, qs, event)

    const task = buildTask({ type, domain, input, event, context })

    const result = await adf.orchestrator.execute(task, {
      apiKey,
      bearerToken,
      ...adf.getRuntime(),
    })

    return taskResultToLambdaResponse(result)
  }

  return errorResponse(`Cannot ${method} ${path}`, 404, 'NOT_FOUND')
}
