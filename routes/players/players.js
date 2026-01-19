import { supabaseAdmin } from '../../services/db.js';
import { successResponse, errorResponse } from '../../utils/response.js';
import { validateBody } from '../../utils/validator.js';
import { validateApiKey, extractBearerToken } from '../../utils/security.js';
import { encodeNext, decodeNext } from '../../utils/pagination.js';

const getAuthUser = async (event) => {
  validateApiKey(event);
  const token = extractBearerToken(event);
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  
  if (error || !user) {
    throw new Error('Unauthorized: Invalid token');
  }
  return user;
};

export const createPlayer = async (event) => {
  try {
    const user = await getAuthUser(event);
    const body = validateBody(event.body, ['org_id', 'first_name', 'last_name', 'national_id', 'birth_date']);

    // TODO: Check if user has permission (Admin or Club User?)
    // A Club User might create a player if they want to add them to their roster immediately?
    // Usually Players are created by Org Admin or Club Admin.

    const { data, error } = await supabaseAdmin
      .from('lg_players')
      .insert({
        org_id: body.org_id,
        first_name: body.first_name,
        last_name: body.last_name,
        national_id: body.national_id,
        birth_date: body.birth_date,
        address: body.address,
        phone: body.phone,
        email: body.email,
        photo_url: body.photo_url,
        jersey_number: body.jersey_number,
        position: body.position,
        category_id: body.category_id
      })
      .select()
      .single();

    if (error) throw error;

    return successResponse({ player: data }, 201);
  } catch (error) {
    console.error('createPlayer Error:', error);
    // Handle unique constraint violation
    if (error.code === '23505') {
      return errorResponse('Player with this National ID already exists in the organization', 409, 'DUPLICATE_ENTRY');
    }
    return errorResponse(error.message, error.statusCode || 500, error.code);
  }
};

export const getPlayers = async (event) => {
  try {
    const user = await getAuthUser(event);
    const { org_id, limit: limitParam, next_token } = event.queryStringParameters || {};

    let offset = 0;
    let effectiveLimit;

    if (next_token) {
      const decoded = decodeNext(next_token);
      if (!decoded || typeof decoded.offset !== 'number' || typeof decoded.limit !== 'number') {
        return errorResponse('next_token inválido', 400, 'INVALID_NEXT_TOKEN');
      }
      offset = decoded.offset;
      effectiveLimit = decoded.limit;
    } else {
      const parsedLimit = parseInt(limitParam, 10);
      effectiveLimit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 10;
    }

    let query = supabaseAdmin.from('lg_players').select('*', { count: 'exact' });

    if (org_id) {
      query = query.eq('org_id', org_id);
    }

    query = query.order('last_name', { ascending: true }).order('first_name', { ascending: true }).range(offset, offset + effectiveLimit - 1);

    const { data, error, count } = await query;

    if (error) throw error;

    const total = count || 0;
    const hasMore = offset + effectiveLimit < total;
    const newNextToken = hasMore ? encodeNext(offset + effectiveLimit, effectiveLimit) : null;

    return successResponse({
      data,
      next_token: newNextToken,
      total_registros: total,
      limit: effectiveLimit,
    });
  } catch (error) {
    console.error('getPlayers Error:', error);
    return errorResponse(error.message, error.statusCode || 500, error.code);
  }
};

export const getPlayerById = async (event) => {
  try {
    const user = await getAuthUser(event);
    const { playerId } = event.pathParameters;

    const { data, error } = await supabaseAdmin
      .from('lg_players')
      .select('*')
      .eq('id', playerId)
      .single();

    if (error) throw error;

    return successResponse({ player: data });
  } catch (error) {
    console.error('getPlayerById Error:', error);
    return errorResponse(error.message, error.statusCode || 500, error.code);
  }
};

export const updatePlayer = async (event) => {
  try {
    const user = await getAuthUser(event);
    const { playerId } = event.pathParameters;
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;

    const { data, error } = await supabaseAdmin
      .from('lg_players')
      .update(body)
      .eq('id', playerId)
      .select()
      .single();

    if (error) throw error;

    return successResponse({ player: data });
  } catch (error) {
    console.error('updatePlayer Error:', error);
    return errorResponse(error.message, error.statusCode || 500, error.code);
  }
};
