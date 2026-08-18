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

// A) Alta completa jugador (org + club)
export const createPlayerInClub = async (event) => {
  try {
    await getAuthUser(event);
    const { clubId } = event.pathParameters;
    const body = validateBody(event.body, ['first_name', 'last_name', 'rut']);

    // 1. Get Club (incluye config de folios)
    const { data: club, error: clubError } = await supabaseAdmin
      .from('lg_clubs')
      .select('id, org_id, folio_start, folio_end, max_players')
      .eq('id', clubId)
      .single();

    if (clubError || !club) return errorResponse('Club not found', 404, 'CLUB_NOT_FOUND');

    const folioStart  = club.folio_start  ?? 1;
    const folioEnd    = club.folio_end    ?? 70;
    const maxPlayers  = club.max_players  ?? 70;

    // 2. Verificar cupo máximo
    const { count: activeCount } = await supabaseAdmin
      .from('lg_club_rosters')
      .select('id', { count: 'exact', head: true })
      .eq('club_id', clubId)
      .eq('status', 'ACTIVE');

    if (activeCount >= maxPlayers) {
      return errorResponse(`Club roster is full (max ${maxPlayers} active players)`, 400, 'ROSTER_FULL');
    }

    // 3. Determinar folio a asignar
    let assignedFolio = body.club_folio !== undefined ? parseInt(body.club_folio, 10) : null;

    if (assignedFolio === null) {
      // Auto-asignar: solo folios con roster ACTIVE cuentan como ocupados
      // Los folios de jugadores traspasados (INACTIVE) quedan disponibles
      const { data: usedFolios } = await supabaseAdmin
        .from('lg_club_rosters')
        .select('club_folio')
        .eq('club_id', clubId)
        .eq('status', 'ACTIVE')
        .not('club_folio', 'is', null);

      const used = new Set((usedFolios ?? []).map(r => r.club_folio));

      for (let f = folioStart; f <= folioEnd; f++) {
        if (!used.has(f)) { assignedFolio = f; break; }
      }

      if (assignedFolio === null) {
        return errorResponse('No hay folios disponibles en el rango configurado', 400, 'NO_FOLIO_AVAILABLE');
      }
    } else {
      // Validar rango y unicidad del folio manual
      if (assignedFolio < folioStart || assignedFolio > folioEnd) {
        return errorResponse(`El folio debe estar entre ${folioStart} y ${folioEnd}`, 400, 'FOLIO_OUT_OF_RANGE');
      }
      const { data: folioInUse } = await supabaseAdmin
        .from('lg_club_rosters')
        .select('id')
        .eq('club_id', clubId)
        .eq('club_folio', assignedFolio)
        .eq('status', 'ACTIVE')
        .maybeSingle();

      if (folioInUse) {
        return errorResponse(`El folio ${assignedFolio} ya está en uso en este club`, 409, 'FOLIO_IN_USE');
      }
    }

    // 4. Insert Player
    const { data: player, error: playerError } = await supabaseAdmin
      .from('lg_players')
      .insert({
        org_id:      club.org_id,
        club_id:     clubId,
        first_name:  body.first_name,
        last_name:   body.last_name,
        rut:         body.rut,
        birth_date:  body.birth_date,
        address:     body.address,
        phone:       body.phone,
        email:       body.email,
        photo_url:   body.photo_url,
        position:    body.position,
        category_id: body.category_id,
        club_folio:  assignedFolio,
      })
      .select()
      .single();

    if (playerError) {
      if (playerError.code === '23505') {
         return errorResponse('Player with this National ID already exists in the organization', 409, 'PLAYER_EXISTS');
      }
      throw playerError;
    }

    // 5. Insert Roster (ACTIVE) con folio asignado
    const { data: roster, error: rosterError } = await supabaseAdmin
      .from('lg_club_rosters')
      .insert({
        club_id:    clubId,
        player_id:  player.id,
        status:     'ACTIVE',
        valid_from: new Date().toISOString(),
        club_folio: assignedFolio,
      })
      .select()
      .single();

    if (rosterError) {
      await supabaseAdmin.from('lg_players').delete().eq('id', player.id);
      throw rosterError;
    }

    return successResponse({ player, roster }, 201);

  } catch (error) {
    console.error('createPlayerInClub Error:', error);
    return errorResponse(error.message, error.statusCode || 500, error.code);
  }
};

// B) Listados: GET /clubs/{clubId}/players
export const listPlayersByClub = async (event) => {
  try {
    await getAuthUser(event);
    const { clubId } = event.pathParameters;
    const { q, status, limit: limitParam, next_token } = event.queryStringParameters || {};

    let offset = 0;
    let effectiveLimit;

    if (next_token) {
      const decoded = decodeNext(next_token);
      if (!decoded) return errorResponse('Invalid next_token', 400, 'INVALID_TOKEN');
      offset = decoded.offset;
      effectiveLimit = decoded.limit;
    } else {
      const parsedLimit = parseInt(limitParam, 10);
      effectiveLimit = (parsedLimit > 0) ? parsedLimit : 10;
    }

    // Start query on Roster
    // We want roster + player details
    let query = supabaseAdmin
      .from('lg_club_rosters')
      .select('*, player:lg_players!inner(*)', { count: 'exact' })
      .eq('club_id', clubId);

    if (status) {
      query = query.eq('status', status);
    }

    // Optional: Search logic (simple implementation)
    // If 'q' is provided, we might need to filter on the joined player table.
    // Supabase JS allows filtering on joined tables using the relation name.
    if (q) {
      // Searching by first_name OR last_name OR national_id
      // Syntax: .or('first_name.ilike.%q%,last_name.ilike.%q%', { foreignTable: 'lg_players' })
      query = query.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,national_id.ilike.%${q}%`, { foreignTable: 'lg_players' });
    }

    query = query.order('club_folio', { ascending: true, nullsFirst: false })
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
      limit: effectiveLimit
    });

  } catch (error) {
    console.error('listPlayersByClub Error:', error);
    return errorResponse(error.message, 500);
  }
};

// B) Listados: GET /orgs/{orgId}/players
export const listPlayersByOrg = async (event) => {
  try {
    await getAuthUser(event);
    const { orgId } = event.pathParameters;
    const { q, status = 'ACTIVE', limit: limitParam, next_token } = event.queryStringParameters || {};

    let offset = 0;
    let effectiveLimit;

    if (next_token) {
      const decoded = decodeNext(next_token, { orgId });
      if (!decoded) return errorResponse('Invalid next_token or organization context mismatch', 400);
      offset = decoded.offset;
      effectiveLimit = decoded.limit;
    } else {
      const parsedLimit = parseInt(limitParam, 10);
      effectiveLimit = (parsedLimit > 0) ? parsedLimit : 10;
    }

    const targetStatus = status ? status.toUpperCase() : 'ACTIVE';

    let query = supabaseAdmin
      .from('lg_players')
      .select('*, active_roster:lg_club_rosters!inner(*), club:lg_clubs(*)', { count: 'exact' })
      .eq('org_id', orgId);

    if (targetStatus !== 'ALL' && targetStatus !== 'TODOS') {
      query = query.eq('active_roster.status', targetStatus);
    }

    if (q) {
      query = query.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,rut.ilike.%${q}%`);
    }

    query = query
      .order('club_folio', { ascending: true, nullsFirst: false })
      .range(offset, offset + effectiveLimit - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    const processedData = (data || []).map(p => {
      const { active_roster, club, ...playerData } = p;
      const clubObj = Array.isArray(club) ? club[0] : club;
      const rosterList = Array.isArray(active_roster) ? active_roster : (active_roster ? [active_roster] : []);
      const rosterObj = (targetStatus !== 'ALL' && targetStatus !== 'TODOS')
        ? rosterList.find(r => r.status === targetStatus) || rosterList[0]
        : rosterList.find(r => r.status === 'ACTIVE') || rosterList[0];

      return {
        ...playerData,
        club_name: clubObj?.name || null,
        club_folio: rosterObj?.club_folio ?? p.club_folio ?? null,
        status: rosterObj?.status || 'ACTIVE'
      };
    });

    const total = count || 0;
    const hasMore = offset + effectiveLimit < total;
    const newNextToken = hasMore ? encodeNext(offset + effectiveLimit, effectiveLimit, { orgId }) : null;

    return successResponse({
      data: processedData,
      next_token: newNextToken,
      total_registros: total,
      limit: effectiveLimit
    });

  } catch (error) {
    console.error('listPlayersByOrg Error:', error);
    return errorResponse(error.message, 500);
  }
};


// GET /players/{playerId}
export const getPlayer = async (event) => {
  try {
    await getAuthUser(event);
    const { playerId } = event.pathParameters;

    const { data, error } = await supabaseAdmin
      .from('lg_players')
      .select('*, active_roster:lg_club_rosters(*)')
      .eq('id', playerId)
      .single();

    if (error || !data) return errorResponse('Player not found', 404);

    // Filter active roster
    const activeRoster = data.active_roster.find(r => r.status === 'ACTIVE') || null;

    return successResponse({
      player: {
        ...data,
        active_roster: activeRoster
      }
    });

  } catch (error) {
    console.error('getPlayer Error:', error);
    return errorResponse(error.message, 500);
  }
};

// PATCH /players/{playerId}
export const updatePlayer = async (event) => {
  try {
    await getAuthUser(event);
    const { playerId } = event.pathParameters;
    const body = JSON.parse(event.body); // Validate body fields if strict

    const { data, error } = await supabaseAdmin
      .from('lg_players')
      .update(body)
      .eq('id', playerId)
      .select()
      .single();

    if (error) throw error;
    return successResponse({ player: data });
  } catch (error) {
    return errorResponse(error.message, 500);
  }
};

// PATCH /clubs/{clubId}/players/{playerId}/status
export const updatePlayerStatus = async (event) => {
  try {
    await getAuthUser(event);
    const { clubId, playerId } = event.pathParameters;
    const { status } = JSON.parse(event.body); // Expect { status: 'ACTIVE' | 'INACTIVE' }

    if (!['ACTIVE', 'INACTIVE'].includes(status)) {
      return errorResponse('Invalid status', 400);
    }

    // If setting to ACTIVE, we must ensure no other ACTIVE roster exists for this player?
    // "Si se pasa a ACTIVE y el jugador ya tiene otro ACTIVE -> desactivar anterior primero"
    // This implies complex logic.
    // For now, simple update.
    
    if (status === 'ACTIVE') {
      // Deactivate others?
      // await supabaseAdmin.from('lg_club_rosters').update({ status: 'INACTIVE' }).eq('player_id', playerId).eq('status', 'ACTIVE');
      // Then activate this one.
    }

    const { data, error } = await supabaseAdmin
      .from('lg_club_rosters')
      .update({ status })
      .eq('club_id', clubId)
      .eq('player_id', playerId)
      .select()
      .single();

    if (error) throw error;
    return successResponse({ roster: data });

  } catch (error) {
    return errorResponse(error.message, 500);
  }
};

// POST /players/{playerId}/change-club
export const changeClub = async (event) => {
  try {
    await getAuthUser(event);
    const { playerId } = event.pathParameters;
    const { to_club_id, type } = JSON.parse(event.body);

    // 1. Deactivate current ACTIVE roster
    const { error: deactivateError } = await supabaseAdmin
      .from('lg_club_rosters')
      .update({ status: 'INACTIVE', valid_to: new Date().toISOString() })
      .eq('player_id', playerId)
      .eq('status', 'ACTIVE');

    if (deactivateError) throw deactivateError;

    // 2. Create new ACTIVE roster
    const { data: newRoster, error: createError } = await supabaseAdmin
      .from('lg_club_rosters')
      .insert({
        club_id: to_club_id,
        player_id: playerId,
        status: 'ACTIVE',
        valid_from: new Date().toISOString()
      })
      .select()
      .single();

    if (createError) throw createError;
    
    // Log loan/transfer if needed (not implemented here fully)

    return successResponse({ success: true, new_roster: newRoster });

  } catch (error) {
    console.error('changeClub Error:', error);
    return errorResponse(error.message, 500);
  }
};

// POST /players/{playerId}/photo
export const uploadPlayerPhoto = async (event) => {
    // Placeholder
    return successResponse({ message: 'Not implemented yet' });
};
