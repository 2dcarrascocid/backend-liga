import { supabaseAdmin } from '../../services/db.js';
import { successResponse, errorResponse } from '../../utils/response.js';
import { validateBody } from '../../utils/validator.js';
import { validateApiKey, extractBearerToken } from '../../utils/security.js';
import { encodeNext, decodeNext } from '../../utils/pagination.js';

const getAuthUser = async (event) => {
  validateApiKey(event);
  const token = extractBearerToken(event);
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) throw new Error('Unauthorized: Invalid token');
  return user;
};

export const addRoster = async (event) => {
  try {
    const user = await getAuthUser(event);
    const { clubId } = event.pathParameters;
    const body = validateBody(event.body, ['player_id']);

    // Check business rule: Player can only be active in one club
    // We check if player is active in ANY club roster
    const { data: activeRoster, error: activeError } = await supabaseAdmin
      .from('lg_club_rosters')
      .select('id, club_id')
      .eq('player_id', body.player_id)
      .eq('status', 'ACTIVE')
      .single();

    if (activeRoster) {
      return errorResponse(`Player is already active in club ${activeRoster.club_id}`, 400, 'PLAYER_ALREADY_ACTIVE');
    }

    // Insert into roster
    // We assume DB handles folio generation and max 70 check via triggers as stated in requirements
    // If not, we'd need to calculate folio here.
    // Let's rely on DB first, if it fails we'll know.
    // Actually, "folio correlativo automático" usually implies DB trigger.

    const { data, error } = await supabaseAdmin
      .from('lg_club_rosters')
      .insert({
        club_id: clubId,
        player_id: body.player_id,
        status: 'ACTIVE',
        valid_from: body.valid_from || new Date(),
        valid_to: body.valid_to
      })
      .select()
      .single();

    if (error) {
       // Check for specific DB errors if possible
       if (error.message.includes('70')) { // Hypothetical error message
         return errorResponse('Club roster limit reached (70 players)', 400, 'ROSTER_LIMIT_REACHED');
       }
       throw error;
    }

    return successResponse({ roster: data }, 201);
  } catch (error) {
    console.error('addRoster Error:', error);
    return errorResponse(error.message, error.statusCode || 500, error.code);
  }
};

export const getRoster = async (event) => {
  try {
    const user = await getAuthUser(event);
    const { clubId } = event.pathParameters;
    const { limit: limitParam, next_token } = event.queryStringParameters || {};

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

    const query = supabaseAdmin
      .from('lg_club_rosters')
      .select('*, player:lg_players(*)', { count: 'exact' })
      .eq('club_id', clubId)
      .order('club_folio', { ascending: true })
      .range(offset, offset + effectiveLimit - 1);

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
    console.error('getRoster Error:', error);
    return errorResponse(error.message, error.statusCode || 500, error.code);
  }
};

export const updateRoster = async (event) => {
  try {
    const user = await getAuthUser(event);
    const { clubId, rosterId } = event.pathParameters;
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;

    // Only allow status update or valid_to?
    const { data, error } = await supabaseAdmin
      .from('lg_club_rosters')
      .update(body)
      .eq('id', rosterId)
      .eq('club_id', clubId) // Ensure it belongs to the club
      .select()
      .single();

    if (error) throw error;

    return successResponse({ roster: data });
  } catch (error) {
    console.error('updateRoster Error:', error);
    return errorResponse(error.message, error.statusCode || 500, error.code);
  }
};
