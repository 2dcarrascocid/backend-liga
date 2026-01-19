import { supabaseAdmin } from '../../services/db.js';
import { successResponse, errorResponse } from '../../utils/response.js';
import { validateBody } from '../../utils/validator.js';
import { validateApiKey, extractBearerToken } from '../../utils/security.js';
import { encodeNext, decodeNext } from '../../utils/pagination.js';

// Helper to validate user and return user object
const getAuthUser = async (event) => {
  validateApiKey(event);
  const token = extractBearerToken(event);
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  
  if (error || !user) {
    throw new Error('Unauthorized: Invalid token');
  }
  return user;
};

// Helper to check if user is Org Admin
const isOrgAdmin = async (userId, orgId) => {
  const { data, error } = await supabaseAdmin
    .from('lg_org_users')
    .select('role')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .single();
    
  if (error || !data) return false;
  return data.role === 'ADMIN';
};

export const createClub = async (event) => {
  try {
    const user = await getAuthUser(event);
    const body = validateBody(event.body, ['org_id', 'name']);
    
    // Check permissions
    const isAdmin = await isOrgAdmin(user.id, body.org_id);
    if (!isAdmin) {
      return errorResponse('Forbidden: You are not an admin of this organization', 403, 'FORBIDDEN');
    }

    const { data, error } = await supabaseAdmin
      .from('lg_clubs')
      .insert({
        org_id: body.org_id,
        name: body.name,
        short_name: body.short_name,
        colors: body.colors,
        logo_url: body.logo_url,
        description: body.description,
        active: body.active !== undefined ? body.active : true
      })
      .select()
      .single();

    if (error) throw error;

    return successResponse({ club: data }, 201);
  } catch (error) {
    console.error('createClub Error:', error);
    return errorResponse(error.message, error.statusCode || 500, error.code);
  }
};

export const getClubs = async (event) => {
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

    let query = supabaseAdmin.from('lg_clubs').select('*', { count: 'exact' });

    if (org_id) {
      query = query.eq('org_id', org_id);
    }

    query = query.order('created_at', { ascending: false }).range(offset, offset + effectiveLimit - 1);

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
    console.error('getClubs Error:', error);
    return errorResponse(error.message, error.statusCode || 500, error.code);
  }
};

export const getClubById = async (event) => {
  try {
    const user = await getAuthUser(event);
    const { clubId } = event.pathParameters;

    const { data, error } = await supabaseAdmin
      .from('lg_clubs')
      .select('*')
      .eq('id', clubId)
      .single();

    if (error) throw error;

    return successResponse({ club: data });
  } catch (error) {
    console.error('getClubById Error:', error);
    return errorResponse(error.message, error.statusCode || 500, error.code);
  }
};

export const updateClub = async (event) => {
  try {
    const user = await getAuthUser(event);
    const { clubId } = event.pathParameters;
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;

    // TODO: Add stricter permission checks (Admin or Club Manager)
    // For now, allow update if authenticated, but in production should check lg_club_users or lg_org_users

    const { data, error } = await supabaseAdmin
      .from('lg_clubs')
      .update(body)
      .eq('id', clubId)
      .select()
      .single();

    if (error) throw error;

    return successResponse({ club: data });
  } catch (error) {
    console.error('updateClub Error:', error);
    return errorResponse(error.message, error.statusCode || 500, error.code);
  }
};

export const addClubUser = async (event) => {
  try {
    const user = await getAuthUser(event);
    const { clubId } = event.pathParameters;
    const body = validateBody(event.body, ['user_id']);

    // Check if requester is Admin (needs org_id of the club)
    const { data: club } = await supabaseAdmin.from('lg_clubs').select('org_id').eq('id', clubId).single();
    if (!club) return errorResponse('Club not found', 404);

    const isAdmin = await isOrgAdmin(user.id, club.org_id);
    if (!isAdmin) {
       return errorResponse('Forbidden: Only Org Admins can add club users', 403);
    }

    const { data, error } = await supabaseAdmin
      .from('lg_club_users')
      .insert({
        club_id: clubId,
        user_id: body.user_id
      })
      .select()
      .single();

    if (error) throw error;

    return successResponse({ club_user: data }, 201);
  } catch (error) {
    console.error('addClubUser Error:', error);
    return errorResponse(error.message, error.statusCode || 500, error.code);
  }
};

export const removeClubUser = async (event) => {
  try {
    const user = await getAuthUser(event);
    const { clubId, userId } = event.pathParameters;

    // Check if requester is Admin
    const { data: club } = await supabaseAdmin.from('lg_clubs').select('org_id').eq('id', clubId).single();
    if (!club) return errorResponse('Club not found', 404);

    const isAdmin = await isOrgAdmin(user.id, club.org_id);
    if (!isAdmin) {
       return errorResponse('Forbidden: Only Org Admins can remove club users', 403);
    }

    const { error } = await supabaseAdmin
      .from('lg_club_users')
      .delete()
      .eq('club_id', clubId)
      .eq('user_id', userId);

    if (error) throw error;

    return successResponse({ message: 'User removed from club' });
  } catch (error) {
    console.error('removeClubUser Error:', error);
    return errorResponse(error.message, error.statusCode || 500, error.code);
  }
};
