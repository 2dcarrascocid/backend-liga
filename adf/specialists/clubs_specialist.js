/**
 * ADF - Clubs Specialist (Specialists Layer)
 *
 * Ejecuta operaciones del dominio de clubes y plantillas (rosters).
 *
 * DO:
 *   - Operar sobre lg_clubs, lg_club_users, lg_club_rosters
 *   - Verificar permisos de org admin antes de operaciones de escritura
 *   - Usar paginación en todos los listados
 *
 * DON'T:
 *   - No crear jugadores — ese es dominio del PlayersSpecialist
 *   - No lanzar excepciones no controladas
 *   - No omitir validación de org admin en CREATE/UPDATE/DELETE
 *
 * Capabilities:
 *   CREATE_CLUB | GET_CLUBS | GET_CLUB | UPDATE_CLUB |
 *   ADD_CLUB_USER | REMOVE_CLUB_USER |
 *   ADD_ROSTER | GET_ROSTER | UPDATE_ROSTER
 *
 * Reglas de nómina (folio):
 *   - Cada club tiene folio_start, folio_end, max_players
 *   - Los folios son únicos por organización — no pueden solaparse entre clubes
 *   - folio_start y folio_end son ingresados por el admin al CREAR el club
 *   - El backend valida que el rango no se superponga con otros clubes de la org
 *   - active_players_count se obtiene con query separada (no alias PostgREST)
 *
 * Checklist:
 *   [ ] ¿Se verificó membresía de org antes de mutaciones?
 *   [ ] ¿Los listados usan paginación?
 *   [ ] ¿Se validó solapamiento de folios en CREATE_CLUB?
 *   [ ] ¿active_players_count viene de query separada?
 *   [ ] ¿Los errores de DB son mapeados a mensajes claros?
 */

import { Skill } from '../contracts/skill_contract.js';
import { createSkillResult } from '../contracts/task_schema.js';
import crypto from 'crypto';
import { sendClubAdminInviteEmail } from '../../utils/mailer.js';

const CAPABILITIES = [
  'CREATE_CLUB', 'GET_CLUBS', 'GET_CLUB', 'UPDATE_CLUB',
  'ADD_CLUB_USER', 'REMOVE_CLUB_USER',
  'ADD_ROSTER', 'GET_ROSTER', 'UPDATE_ROSTER',
  'INVITE_CLUB_ADMIN', 'GET_CLUB_ADMINS', 'REMOVE_CLUB_ADMIN',
];

export class ClubsSpecialist extends Skill {
  constructor() {
    super('clubs_specialist', '1.0.0');
    this.domain = 'clubs';
    this.capabilities = CAPABILITIES;

    this.contract = {
      input: [
        { name: 'operation', required: true, type: 'string' },
        { name: 'payload', required: true, type: 'object' },
        { name: 'db', required: true, type: 'object' },
        { name: 'userId', required: false, type: 'string' },
      ],
      output: [
        { name: 'club', type: 'object' },
        { name: 'clubs', type: 'array' },
        { name: 'roster', type: 'array' },
        { name: 'nextToken', type: 'string' },
      ],
      rules: {
        do: [
          'Verificar permisos de org en operaciones de escritura',
          'Usar paginación en listados',
          'Retornar datos completos de club incluyendo relaciones necesarias',
        ],
        dont: [
          'No crear ni modificar jugadores',
          'No omitir verificación de org_id en filtros de DB',
        ],
      },
      checklist: [
        'Permisos verificados antes de mutaciones',
        'Paginación aplicada en listados',
        'org_id incluido en filtros de consulta',
        'Errores de DB mapeados correctamente',
      ],
    };
  }

  async execute(task) {
    const { operation, payload, db, userId } = task.input;

    if (!this.capabilities.includes(operation)) {
      return createSkillResult({
        success: false,
        errorCode: 'UNKNOWN_OPERATION',
        errorMessage: `Operación desconocida: "${operation}"`,
      });
    }

    try {
      switch (operation) {
        case 'CREATE_CLUB':      return this._createClub(payload, db, userId);
        case 'GET_CLUBS':        return this._getClubs(payload, db);
        case 'GET_CLUB':         return this._getClub(payload, db);
        case 'UPDATE_CLUB':      return this._updateClub(payload, db, userId);
        case 'ADD_CLUB_USER':      return this._addClubUser(payload, db, userId);
        case 'REMOVE_CLUB_USER':   return this._removeClubUser(payload, db, userId);
        case 'ADD_ROSTER':         return this._addRoster(payload, db);
        case 'GET_ROSTER':         return this._getRoster(payload, db);
        case 'UPDATE_ROSTER':      return this._updateRoster(payload, db);
        case 'INVITE_CLUB_ADMIN':  return this._inviteClubAdmin(payload, db, userId);
        case 'GET_CLUB_ADMINS':    return this._getClubAdmins(payload, db);
        case 'REMOVE_CLUB_ADMIN':  return this._removeClubAdmin(payload, db, userId);
      }
    } catch (err) {
      return createSkillResult({
        success: false,
        errorCode: 'CLUBS_SPECIALIST_ERROR',
        errorMessage: err.message,
      });
    }
  }

  async _createClub({ orgId, name, shortName, colors, logoUrl, description, folioStart, folioEnd, maxPlayers = 70 }, db, userId) {
    // Verificar org admin
    const { data: membership } = await db
      .from('lg_org_users')
      .select('role')
      .eq('user_id', userId)
      .eq('org_id', orgId)
      .maybeSingle();

    if (!membership || membership.role !== 'ADMIN') {
      return createSkillResult({
        success: false,
        errorCode: 'FORBIDDEN',
        errorMessage: 'Solo el ADMIN de la organización puede crear clubes',
      });
    }

    if (!folioStart || !folioEnd) {
      return createSkillResult({ success: false, errorCode: 'MISSING_FOLIO', errorMessage: 'folio_start y folio_end son requeridos' });
    }
    if (folioEnd <= folioStart) {
      return createSkillResult({ success: false, errorCode: 'INVALID_FOLIO_RANGE', errorMessage: 'folio_end debe ser mayor que folio_start' });
    }

    // Verificar solapamiento de rango con otros clubes de la org
    const { data: overlap } = await db
      .from('lg_clubs')
      .select('id, name, folio_start, folio_end')
      .eq('org_id', orgId)
      .or(`folio_start.lte.${folioEnd},folio_end.gte.${folioStart}`)
      .not('folio_start', 'is', null)
      .maybeSingle();

    if (overlap) {
      return createSkillResult({
        success: false,
        errorCode: 'FOLIO_RANGE_OVERLAP',
        errorMessage: `El rango ${folioStart}–${folioEnd} se superpone con el club "${overlap.name}" (${overlap.folio_start}–${overlap.folio_end})`,
      });
    }

    const { data: club, error } = await db
      .from('lg_clubs')
      .insert({
        org_id:      orgId,
        name,
        short_name:  shortName,
        colors,
        logo_url:    logoUrl,
        description,
        folio_start: folioStart,
        folio_end:   folioEnd,
        max_players: maxPlayers,
      })
      .select()
      .single();

    if (error) {
      return createSkillResult({ success: false, errorCode: 'CREATE_CLUB_FAILED', errorMessage: error.message });
    }

    return createSkillResult({ success: true, data: { club } });
  }

  async _getClubs({ orgId, limit = 20, nextToken }, db) {
    let query = db
      .from('lg_clubs')
      .select('id, name, short_name, colors, logo_url, active, created_at')
      .order('name');

    if (orgId) query = query.eq('org_id', orgId);
    if (nextToken) {
      try {
        const offset = parseInt(Buffer.from(nextToken, 'base64').toString(), 10);
        query = query.range(offset, offset + limit - 1);
      } catch {
        query = query.limit(limit);
      }
    } else {
      query = query.limit(limit);
    }

    const { data: clubs, error } = await query;
    if (error) {
      return createSkillResult({ success: false, errorCode: 'GET_CLUBS_FAILED', errorMessage: error.message });
    }

    // Contar jugadores activos para todos los clubes en una sola query adicional
    if (clubs.length > 0) {
      const clubIds = clubs.map(c => c.id);
      const { data: rosters } = await db
        .from('lg_club_rosters')
        .select('club_id')
        .in('club_id', clubIds)
        .eq('status', 'ACTIVE');

      const countByClub = {};
      (rosters || []).forEach(r => {
        countByClub[r.club_id] = (countByClub[r.club_id] || 0) + 1;
      });

      clubs.forEach(c => {
        c.active_players_count = countByClub[c.id] || 0;
      });
    }

    const hasMore = clubs.length === limit;
    const next = hasMore ? Buffer.from(String(limit)).toString('base64') : null;

    return createSkillResult({ success: true, data: { clubs, nextToken: next } });
  }

  async _getClub({ clubId }, db) {
    const [{ data: club, error }, { count }] = await Promise.all([
      db.from('lg_clubs').select('*').eq('id', clubId).single(),
      db.from('lg_club_rosters')
        .select('id', { count: 'exact', head: true })
        .eq('club_id', clubId)
        .eq('status', 'ACTIVE'),
    ]);

    if (error || !club) {
      return createSkillResult({ success: false, errorCode: 'CLUB_NOT_FOUND', errorMessage: 'Club no encontrado' });
    }

    return createSkillResult({ success: true, data: { club: { ...club, active_players_count: count ?? 0 } } });
  }

  async _updateClub({ clubId, ...updates }, db, userId) {
    const allowed = ['name', 'short_name', 'colors', 'logo_url', 'description', 'active',
                     'folio_start', 'folio_end', 'max_players'];
    const patch = Object.fromEntries(
      Object.entries(updates).filter(([k]) => allowed.includes(k))
    );

    if (Object.keys(patch).length === 0) {
      return createSkillResult({ success: false, errorCode: 'NO_FIELDS', errorMessage: 'No hay campos válidos para actualizar' });
    }

    const { data: club, error } = await db
      .from('lg_clubs')
      .update(patch)
      .eq('id', clubId)
      .select()
      .single();

    if (error) {
      return createSkillResult({ success: false, errorCode: 'UPDATE_CLUB_FAILED', errorMessage: error.message });
    }

    return createSkillResult({ success: true, data: { club } });
  }

  async _addClubUser({ clubId, userId: targetUserId, role = 'MEMBER' }, db, requestingUserId) {
    const { data: club } = await db.from('lg_clubs').select('org_id').eq('id', clubId).single();
    if (!club) return createSkillResult({ success: false, errorCode: 'CLUB_NOT_FOUND', errorMessage: 'Club no encontrado' });

    const { data: admin } = await db
      .from('lg_org_users')
      .select('role')
      .eq('user_id', requestingUserId)
      .eq('org_id', club.org_id)
      .maybeSingle();

    if (!admin || admin.role !== 'ADMIN') {
      return createSkillResult({ success: false, errorCode: 'FORBIDDEN', errorMessage: 'Solo el ADMIN puede agregar usuarios al club' });
    }

    const { error } = await db
      .from('lg_club_users')
      .upsert({ club_id: clubId, user_id: targetUserId, role }, { onConflict: 'club_id,user_id' });

    if (error) return createSkillResult({ success: false, errorCode: 'ADD_USER_FAILED', errorMessage: error.message });

    return createSkillResult({ success: true, data: { clubId, userId: targetUserId, role } });
  }

  async _removeClubUser({ clubId, userId: targetUserId }, db, requestingUserId) {
    const { data: club } = await db.from('lg_clubs').select('org_id').eq('id', clubId).single();
    if (!club) return createSkillResult({ success: false, errorCode: 'CLUB_NOT_FOUND', errorMessage: 'Club no encontrado' });

    const { data: admin } = await db
      .from('lg_org_users')
      .select('role')
      .eq('user_id', requestingUserId)
      .eq('org_id', club.org_id)
      .maybeSingle();

    if (!admin || admin.role !== 'ADMIN') {
      return createSkillResult({ success: false, errorCode: 'FORBIDDEN', errorMessage: 'Solo el ADMIN puede remover usuarios del club' });
    }

    const { error } = await db
      .from('lg_club_users')
      .delete()
      .eq('club_id', clubId)
      .eq('user_id', targetUserId);

    if (error) return createSkillResult({ success: false, errorCode: 'REMOVE_USER_FAILED', errorMessage: error.message });

    return createSkillResult({ success: true, data: { removed: true } });
  }

  async _addRoster({ clubId, playerId, validFrom, validTo }, db) {
    const { data: roster, error } = await db
      .from('lg_club_rosters')
      .insert({ club_id: clubId, player_id: playerId, status: 'ACTIVE', valid_from: validFrom, valid_to: validTo })
      .select()
      .single();

    if (error) {
      return createSkillResult({ success: false, errorCode: 'ADD_ROSTER_FAILED', errorMessage: error.message });
    }

    return createSkillResult({ success: true, data: { roster } });
  }

  async _getRoster({ clubId, limit = 20, nextToken, status }, db) {
    let query = db
      .from('lg_club_rosters')
      .select('*, lg_players(id, first_name, last_name, national_id, position, jersey_number)')
      .eq('club_id', clubId)
      .order('club_folio');

    if (status) query = query.eq('status', status);
    query = query.limit(limit);

    const { data: roster, error } = await query;
    if (error) return createSkillResult({ success: false, errorCode: 'GET_ROSTER_FAILED', errorMessage: error.message });

    return createSkillResult({ success: true, data: { roster } });
  }

  async _updateRoster({ rosterId, status, validTo }, db) {
    const patch = {};
    if (status !== undefined) patch.status = status;
    if (validTo !== undefined) patch.valid_to = validTo;

    const { data: roster, error } = await db
      .from('lg_club_rosters')
      .update(patch)
      .eq('id', rosterId)
      .select()
      .single();

    if (error) return createSkillResult({ success: false, errorCode: 'UPDATE_ROSTER_FAILED', errorMessage: error.message });

    return createSkillResult({ success: true, data: { roster } });
  }

  // ── Admin-Club ──────────────────────────────────────────────────────────────

  async _inviteClubAdmin({ clubId, email }, db, requestingUserId) {
    // Solo org ADMIN puede invitar
    const { data: club } = await db.from('lg_clubs').select('org_id, name').eq('id', clubId).single();
    if (!club) return createSkillResult({ success: false, errorCode: 'CLUB_NOT_FOUND', errorMessage: 'Club no encontrado' });

    const { data: admin } = await db
      .from('lg_org_users').select('role')
      .eq('user_id', requestingUserId).eq('org_id', club.org_id).maybeSingle();

    if (!admin || admin.role !== 'ADMIN') {
      return createSkillResult({ success: false, errorCode: 'FORBIDDEN', errorMessage: 'Solo el ADMIN puede invitar administradores de club' });
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

    // Generate token in JS — avoids pgcrypto dependency in SQL
    const token      = crypto.randomBytes(32).toString('hex');
    const tokenHash  = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt  = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: invite, error: inviteErr } = await db.rpc('fn_invite_club_admin', {
      p_email:      email.toLowerCase(),
      p_club_id:    clubId,
      p_inviter_id: requestingUserId,
      p_token_hash: tokenHash,
      p_expires_at: expiresAt,
    });

    if (inviteErr) {
      console.error('fn_invite_club_admin error:', inviteErr.message);
      return createSkillResult({ success: false, errorCode: 'INVITE_FAILED', errorMessage: inviteErr.message });
    }

    const { is_new } = invite;

    // Enviar email de invitación
    try {
      const link = is_new
        ? `${frontendUrl}/accept-invite?token=${token}`   // nuevo usuario → crear contraseña
        : `${frontendUrl}/accept-invite?token=${token}`;  // existente → confirmar acceso
      await sendClubAdminInviteEmail(email, club.name, link, is_new);
    } catch (mailErr) {
      console.error('SMTP invite error:', mailErr.message);
    }

    return createSkillResult({
      success: true,
      data: { invited: true, isNewUser: is_new, email },
    });
  }

  async _getClubAdmins({ clubId }, db) {
    const { data: admins, error } = await db.rpc('fn_get_club_admins', { p_club_id: clubId });

    if (error) {
      console.error('fn_get_club_admins error:', error.message);
      return createSkillResult({ success: false, errorCode: 'GET_ADMINS_FAILED', errorMessage: error.message });
    }

    return createSkillResult({ success: true, data: { admins: admins || [] } });
  }

  async _removeClubAdmin({ clubId, adminUserId }, db, requestingUserId) {
    const { data: club } = await db.from('lg_clubs').select('org_id').eq('id', clubId).single();
    if (!club) return createSkillResult({ success: false, errorCode: 'CLUB_NOT_FOUND', errorMessage: 'Club no encontrado' });

    const { data: admin } = await db
      .from('lg_org_users').select('role')
      .eq('user_id', requestingUserId).eq('org_id', club.org_id).maybeSingle();

    if (!admin || admin.role !== 'ADMIN') {
      return createSkillResult({ success: false, errorCode: 'FORBIDDEN', errorMessage: 'Solo el ADMIN puede remover administradores de club' });
    }

    const { error } = await db
      .from('lg_club_users')
      .delete()
      .eq('club_id', clubId)
      .eq('user_id', adminUserId)
      .eq('role', 'ADMIN_CLUB');

    if (error) return createSkillResult({ success: false, errorCode: 'REMOVE_ADMIN_FAILED', errorMessage: error.message });

    return createSkillResult({ success: true, data: { removed: true } });
  }
}
