import { supabaseAdmin } from '../../services/db.js';
import { successResponse, errorResponse } from '../../utils/response.js';
import { validateApiKey, extractBearerToken } from '../../utils/security.js';

const getAuthUser = async (event) => {
  validateApiKey(event);
  const token = extractBearerToken(event);
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) throw new Error('Unauthorized: Invalid token');
  return user;
};

// GET /clubs/:clubId/transfers
// Devuelve traspasos enviados (salientes) y recibidos (entrantes) del club
export const listTransfers = async (event) => {
  try {
    await getAuthUser(event);
    const { clubId } = event.pathParameters;

    const { data, error } = await supabaseAdmin
      .from('lg_transfers')
      .select(`
        *,
        player:lg_players(id, first_name, last_name, rut, birth_date, photo_url),
        from_club:lg_clubs!from_club_id(id, name),
        to_club:lg_clubs!to_club_id(id, name)
      `)
      .or(`from_club_id.eq.${clubId},to_club_id.eq.${clubId}`)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Separar en salientes y entrantes
    const outgoing = data.filter(t => t.from_club_id === clubId);
    const incoming = data.filter(t => t.to_club_id   === clubId);

    return successResponse({ outgoing, incoming });
  } catch (error) {
    console.error('listTransfers Error:', error);
    return errorResponse(error.message, 500);
  }
};

// POST /clubs/:clubId/transfers
// Crea un traspaso desde este club hacia otro
export const createTransfer = async (event) => {
  try {
    await getAuthUser(event);
    const { clubId } = event.pathParameters;
    const body = JSON.parse(event.body);
    const { player_id, to_club_id, notes } = body;

    if (!player_id)  return errorResponse('player_id es requerido', 400, 'MISSING_FIELDS');
    if (!to_club_id) return errorResponse('to_club_id es requerido', 400, 'MISSING_FIELDS');
    if (to_club_id === clubId) return errorResponse('El club destino debe ser distinto', 400, 'SAME_CLUB');

    // Verificar que el jugador esté activo en este club
    const { data: roster, error: rosterError } = await supabaseAdmin
      .from('lg_club_rosters')
      .select('id, status')
      .eq('club_id', clubId)
      .eq('player_id', player_id)
      .eq('status', 'ACTIVE')
      .single();

    if (rosterError || !roster) {
      return errorResponse('El jugador no está activo en este club', 400, 'PLAYER_NOT_IN_CLUB');
    }

    // Verificar que no haya un traspaso pendiente para este jugador
    const { data: pending } = await supabaseAdmin
      .from('lg_transfers')
      .select('id')
      .eq('player_id', player_id)
      .eq('status', 'ENVIADO')
      .maybeSingle();

    if (pending) {
      return errorResponse('El jugador ya tiene un traspaso pendiente', 409, 'TRANSFER_PENDING');
    }

    // Obtener org_id del club origen
    const { data: club } = await supabaseAdmin
      .from('lg_clubs')
      .select('org_id')
      .eq('id', clubId)
      .single();

    const { data: transfer, error } = await supabaseAdmin
      .from('lg_transfers')
      .insert({
        org_id:       club.org_id,
        player_id,
        from_club_id: clubId,
        to_club_id,
        status:       'ENVIADO',
        notes:        notes ?? null,
      })
      .select(`
        *,
        player:lg_players(id, first_name, last_name, rut),
        from_club:lg_clubs!from_club_id(id, name),
        to_club:lg_clubs!to_club_id(id, name)
      `)
      .single();

    if (error) throw error;
    return successResponse({ transfer }, 201);
  } catch (error) {
    console.error('createTransfer Error:', error);
    return errorResponse(error.message, 500);
  }
};

// PATCH /clubs/:clubId/transfers/:transferId/accept
// El club destino acepta el traspaso
export const acceptTransfer = async (event) => {
  try {
    await getAuthUser(event);
    const { clubId, transferId } = event.pathParameters;

    // Cargar el traspaso
    const { data: transfer, error: fetchError } = await supabaseAdmin
      .from('lg_transfers')
      .select('*')
      .eq('id', transferId)
      .eq('to_club_id', clubId)       // solo el club destino puede aceptar
      .eq('status', 'ENVIADO')
      .single();

    if (fetchError || !transfer) {
      return errorResponse('Traspaso no encontrado o no está pendiente', 404, 'TRANSFER_NOT_FOUND');
    }

    // 1. Desactivar el roster activo en el club origen
    const { error: deactivateError } = await supabaseAdmin
      .from('lg_club_rosters')
      .update({ status: 'INACTIVE', valid_to: new Date().toISOString() })
      .eq('player_id', transfer.player_id)
      .eq('club_id', transfer.from_club_id)
      .eq('status', 'ACTIVE');

    if (deactivateError) throw deactivateError;

    // 2. Crear roster activo en el club destino
    const { error: rosterError } = await supabaseAdmin
      .from('lg_club_rosters')
      .insert({
        club_id:    transfer.to_club_id,
        player_id:  transfer.player_id,
        status:     'ACTIVE',
        valid_from: new Date().toISOString(),
      });

    if (rosterError) throw rosterError;

    // 3. Marcar traspaso como ACEPTADO
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('lg_transfers')
      .update({ status: 'ACEPTADO', updated_at: new Date().toISOString() })
      .eq('id', transferId)
      .select()
      .single();

    if (updateError) throw updateError;
    return successResponse({ transfer: updated });
  } catch (error) {
    console.error('acceptTransfer Error:', error);
    return errorResponse(error.message, 500);
  }
};

// PATCH /clubs/:clubId/transfers/:transferId/reject
// El club destino rechaza el traspaso
export const rejectTransfer = async (event) => {
  try {
    await getAuthUser(event);
    const { clubId, transferId } = event.pathParameters;

    const { data: updated, error } = await supabaseAdmin
      .from('lg_transfers')
      .update({ status: 'RECHAZADO', updated_at: new Date().toISOString() })
      .eq('id', transferId)
      .eq('to_club_id', clubId)
      .eq('status', 'ENVIADO')
      .select()
      .single();

    if (error || !updated) {
      return errorResponse('Traspaso no encontrado o no está pendiente', 404, 'TRANSFER_NOT_FOUND');
    }

    return successResponse({ transfer: updated });
  } catch (error) {
    console.error('rejectTransfer Error:', error);
    return errorResponse(error.message, 500);
  }
};

// DELETE /clubs/:clubId/transfers/:transferId
// El club origen cancela un traspaso enviado
export const cancelTransfer = async (event) => {
  try {
    await getAuthUser(event);
    const { clubId, transferId } = event.pathParameters;

    const { error } = await supabaseAdmin
      .from('lg_transfers')
      .delete()
      .eq('id', transferId)
      .eq('from_club_id', clubId)
      .eq('status', 'ENVIADO');

    if (error) throw error;
    return successResponse({ success: true });
  } catch (error) {
    console.error('cancelTransfer Error:', error);
    return errorResponse(error.message, 500);
  }
};
