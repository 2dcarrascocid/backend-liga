/**
 * ADF - Players Specialist (Specialists Layer)
 *
 * Ejecuta operaciones del dominio de jugadores.
 * Maneja: creación, búsqueda, actualización, cambio de club, estado.
 *
 * DO:
 *   - Operar sobre lg_players y lg_club_rosters
 *   - En CREATE_PLAYER: verificar cupo, auto-asignar folio libre del rango del club, crear jugador y roster
 *   - En CHANGE_CLUB: desactivar roster actual, asignar folio libre en nuevo club
 *   - Incluir roster activo en respuestas de detalle de jugador
 *   - Guardar club_folio también en lg_players para consultas directas
 *
 * DON'T:
 *   - No manejar traspasos formales — usar TransfersSpecialist
 *   - No modificar la tabla de auth.users
 *   - No lanzar excepciones no controladas
 *
 * Reglas de folio:
 *   - El club define folio_start, folio_end, max_players en lg_clubs
 *   - Solo los rosters ACTIVE cuentan como "folio ocupado" — los INACTIVE liberan su folio
 *   - Al crear jugador: buscar primer folio libre en [folio_start, folio_end] entre rosters ACTIVE
 *   - Si se provee club_folio manual: validar rango y que no esté en uso en roster ACTIVE
 *   - Errores: ROSTER_FULL | NO_FOLIO_AVAILABLE | FOLIO_OUT_OF_RANGE | FOLIO_IN_USE
 *
 * Capabilities:
 *   CREATE_PLAYER | GET_PLAYER | LIST_PLAYERS_BY_CLUB | LIST_PLAYERS_BY_ORG |
 *   UPDATE_PLAYER | UPDATE_STATUS | CHANGE_CLUB
 *
 * Checklist:
 *   [x] ¿CREATE verifica cupo antes de insertar?
 *   [x] ¿CREATE auto-asigna folio consultando solo rosters ACTIVE?
 *   [x] ¿CREATE valida folio manual contra rosters ACTIVE?
 *   [x] ¿CREATE guarda club_folio en lg_players?
 *   [x] ¿CREATE crea jugador Y roster en secuencia con rollback?
 *   [x] ¿CHANGE_CLUB desactiva el roster anterior y asigna folio en destino?
 *   [x] ¿Los listados incluyen paginación?
 *   [x] ¿Se retorna el roster activo en GET_PLAYER?
 */

import { Skill } from '../contracts/skill_contract.js';
import { createSkillResult } from '../contracts/task_schema.js';
import { encodeNext, decodeNext } from '../../utils/pagination.js';

const CAPABILITIES = [
  'CREATE_PLAYER', 'GET_PLAYER',
  'LIST_PLAYERS_BY_CLUB', 'LIST_PLAYERS_BY_ORG',
  'UPDATE_PLAYER', 'UPDATE_STATUS', 'CHANGE_CLUB', 'UPLOAD_PHOTO',
];

export class PlayersSpecialist extends Skill {
  constructor() {
    super('players_specialist', '1.1.0');
    this.domain = 'players';
    this.capabilities = CAPABILITIES;

    this.contract = {
      input: [
        { name: 'operation', required: true,  type: 'string' },
        { name: 'payload',   required: true,  type: 'object' },
        { name: 'db',        required: true,  type: 'object' },
        { name: 'userId',    required: false, type: 'string' },
      ],
      output: [
        { name: 'player',    type: 'object' },
        { name: 'players',   type: 'array'  },
        { name: 'roster',    type: 'object' },
        { name: 'nextToken', type: 'string' },
      ],
      rules: {
        do: [
          'Crear roster activo junto con el jugador en CREATE_PLAYER',
          'Guardar club_folio en lg_players al crear o cambiar de club',
          'Buscar folio libre solo entre rosters ACTIVE (los INACTIVE liberan folio)',
          'Desactivar roster anterior en CHANGE_CLUB y asignar folio libre en destino',
          'Incluir roster activo en GET_PLAYER',
          'Filtrar por status=ACTIVE en LIST_PLAYERS_BY_CLUB por defecto',
          'Buscar con ilike en listados con query param',
        ],
        dont: [
          'No manejar traspasos formales (usar TransfersSpecialist)',
          'No modificar auth.users',
          'No reutilizar folios de rosters INACTIVE al validar folio manual',
        ],
      },
      checklist: [
        'CREATE_PLAYER crea jugador y roster en secuencia con rollback',
        'CREATE_PLAYER guarda club_folio en lg_players',
        'CHANGE_CLUB desactiva roster previo y asigna folio libre en destino',
        'GET_PLAYER incluye roster activo',
        'Paginación aplicada en listados',
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
        case 'CREATE_PLAYER':         return this._createPlayer(payload, db, userId);
        case 'GET_PLAYER':            return this._getPlayer(payload, db);
        case 'LIST_PLAYERS_BY_CLUB':  return this._listByClub(payload, db);
        case 'LIST_PLAYERS_BY_ORG':   return this._listByOrg(payload, db);
        case 'UPDATE_PLAYER':         return this._updatePlayer(payload, db);
        case 'UPDATE_STATUS':         return this._updateStatus(payload, db, userId);
        case 'CHANGE_CLUB':           return this._changeClub(payload, db, userId);
        case 'UPLOAD_PHOTO':          return this._uploadPhoto(payload, db);
      }
    } catch (err) {
      return createSkillResult({
        success: false,
        errorCode: 'PLAYERS_SPECIALIST_ERROR',
        errorMessage: err.message,
      });
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Obtiene config del club y busca el primer folio libre entre rosters ACTIVE.
   * Los rosters INACTIVE liberan su folio (disponible para reasignar).
   * @returns { folioStart, folioEnd, maxPlayers, assignedFolio } o error
   */
  async _resolveClubFolio(clubId, requestedFolio, db) {
    const { data: club, error: clubErr } = await db
      .from('lg_clubs')
      .select('id, org_id, folio_start, folio_end, max_players')
      .eq('id', clubId)
      .single();

    if (clubErr || !club) {
      return { error: { code: 'CLUB_NOT_FOUND', message: 'Club no encontrado' } };
    }

    const folioStart = club.folio_start ?? 1;
    const folioEnd   = club.folio_end   ?? 70;
    const maxPlayers = club.max_players ?? 70;

    // Verificar cupo
    const { count: activeCount } = await db
      .from('lg_club_rosters')
      .select('id', { count: 'exact', head: true })
      .eq('club_id', clubId)
      .eq('status', 'ACTIVE');

    if (activeCount >= maxPlayers) {
      return { error: { code: 'ROSTER_FULL', message: `El club alcanzó el máximo de ${maxPlayers} jugadores activos` } };
    }

    // Folios actualmente ocupados (solo ACTIVE)
    const { data: usedRows } = await db
      .from('lg_club_rosters')
      .select('club_folio')
      .eq('club_id', clubId)
      .eq('status', 'ACTIVE')
      .not('club_folio', 'is', null);

    const used = new Set((usedRows ?? []).map(r => r.club_folio));

    let assignedFolio;

    if (requestedFolio !== undefined && requestedFolio !== null) {
      const f = parseInt(requestedFolio, 10);
      if (f < folioStart || f > folioEnd) {
        return { error: { code: 'FOLIO_OUT_OF_RANGE', message: `El folio debe estar entre ${folioStart} y ${folioEnd}` } };
      }
      if (used.has(f)) {
        return { error: { code: 'FOLIO_IN_USE', message: `El folio ${f} ya está en uso en este club` } };
      }
      assignedFolio = f;
    } else {
      // Auto-asignar primer folio libre
      assignedFolio = null;
      for (let f = folioStart; f <= folioEnd; f++) {
        if (!used.has(f)) { assignedFolio = f; break; }
      }
      if (assignedFolio === null) {
        return { error: { code: 'NO_FOLIO_AVAILABLE', message: 'No hay folios disponibles en el rango configurado' } };
      }
    }

    return { club, folioStart, folioEnd, maxPlayers, assignedFolio };
  }

  // ── Operations ───────────────────────────────────────────────────────────

  // Verifica que userId sea org ADMIN o ADMIN_CLUB del club específico
  async _assertClubAccess(clubId, userId, db) {
    const { data: club } = await db.from('lg_clubs').select('org_id').eq('id', clubId).single();
    if (!club) return 'CLUB_NOT_FOUND';

    const [{ data: orgAdmin }, { data: clubAdmin }] = await Promise.all([
      db.from('lg_org_users').select('role')
        .eq('user_id', userId).eq('org_id', club.org_id).maybeSingle(),
      db.from('lg_club_users').select('role')
        .eq('user_id', userId).eq('club_id', clubId).eq('role', 'ADMIN_CLUB').maybeSingle(),
    ]);

    if (orgAdmin?.role === 'ADMIN' || clubAdmin?.role === 'ADMIN_CLUB') return null;
    return 'FORBIDDEN';
  }

  async _createPlayer(payload, db, userId) {
    const {
      clubId,
      firstName, lastName, rut, birthDate,
      address, phone, email, photoUrl, position, categoryId,
      clubFolio,
    } = payload;

    const accessError = await this._assertClubAccess(clubId, userId, db);
    if (accessError) {
      return createSkillResult({ success: false, errorCode: accessError, errorMessage: 'No tienes permisos para crear jugadores en este club' });
    }

    // 1. Resolver folio
    const folioResult = await this._resolveClubFolio(clubId, clubFolio, db);
    if (folioResult.error) {
      return createSkillResult({
        success: false,
        errorCode: folioResult.error.code,
        errorMessage: folioResult.error.message,
      });
    }
    const { club, assignedFolio } = folioResult;

    // 2. Insertar jugador (incluye club_folio para consultas directas)
    const { data: player, error: playerErr } = await db
      .from('lg_players')
      .insert({
        org_id:     club.org_id,
        club_id:    clubId,
        first_name: firstName,
        last_name:  lastName,
        rut,
        birth_date: birthDate,
        address,
        phone,
        email,
        photo_url:  photoUrl,
        position,
        category_id: categoryId,
        club_folio:  assignedFolio,
      })
      .select()
      .single();

    if (playerErr) {
      const isDuplicate = playerErr.code === '23505';
      return createSkillResult({
        success: false,
        errorCode: isDuplicate ? 'DUPLICATE_RUT' : 'CREATE_PLAYER_FAILED',
        errorMessage: isDuplicate ? `Ya existe un jugador con RUT "${rut}"` : playerErr.message,
      });
    }

    // 3. Insertar roster activo con folio asignado
    const { data: roster, error: rosterErr } = await db
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

    if (rosterErr) {
      // Rollback jugador
      await db.from('lg_players').delete().eq('id', player.id);
      return createSkillResult({ success: false, errorCode: 'CREATE_ROSTER_FAILED', errorMessage: rosterErr.message });
    }

    return createSkillResult({ success: true, data: { player, roster } });
  }

  async _getPlayer({ playerId }, db) {
    const { data: player, error } = await db
      .from('lg_players')
      .select('*, active_roster:lg_club_rosters(*)')
      .eq('id', playerId)
      .single();

    if (error) return createSkillResult({ success: false, errorCode: 'GET_PLAYER_FAILED', errorMessage: error.message });
    if (!player) return createSkillResult({ success: false, errorCode: 'PLAYER_NOT_FOUND', errorMessage: 'Jugador no encontrado' });

    const activeRoster = (player.active_roster ?? []).find(r => r.status === 'ACTIVE') || null;

    return createSkillResult({ success: true, data: { player: { ...player, active_roster: activeRoster } } });
  }

  async _listByClub({ clubId, q, status = 'ACTIVE', limit = 10, next_token }, db) {
    let offset = 0;
    if (next_token) {
      try { offset = JSON.parse(atob(next_token)).offset ?? 0; } catch { offset = 0; }
    }

    let query = db
      .from('lg_club_rosters')
      .select('*, player:lg_players!inner(*)', { count: 'exact' })
      .eq('club_id', clubId)
      .eq('status', status)
      .order('club_folio', { ascending: true, nullsFirst: false })
      .range(offset, offset + limit - 1);

    if (q) {
      query = query.or(
        `first_name.ilike.%${q}%,last_name.ilike.%${q}%,rut.ilike.%${q}%`,
        { foreignTable: 'lg_players' }
      );
    }

    const { data, error, count } = await query;
    if (error) return createSkillResult({ success: false, errorCode: 'LIST_PLAYERS_FAILED', errorMessage: error.message });

    const total   = count ?? 0;
    const hasMore = offset + limit < total;
    const newToken = hasMore ? btoa(JSON.stringify({ offset: offset + limit, limit })) : null;

    return createSkillResult({ success: true, data: { data, next_token: newToken, total_registros: total, limit } });
  }

  async _listByOrg({ orgId, q, status = 'ACTIVE', limit = 10, next_token }, db) {
    let offset = 0;
    let effectiveLimit = parseInt(limit, 10) || 10;

    if (next_token) {
      const decoded = decodeNext(next_token, { orgId });
      if (decoded) {
        offset = decoded.offset;
        effectiveLimit = decoded.limit;
      } else {
        return createSkillResult({
          success: false,
          errorCode: 'INVALID_NEXT_TOKEN',
          errorMessage: 'Token de paginación inválido o perteneciente a otra organización',
        });
      }
    }

    let query = db
      .from('lg_players')
      .select('*, active_roster:lg_club_rosters!inner(*), club:lg_clubs(*)', { count: 'exact' })
      .eq('org_id', orgId);

    if (status) {
      query = query.eq('active_roster.status', status);
    }

    if (q) {
      query = query.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,rut.ilike.%${q}%`);
    }

    query = query
      .order('last_name', { ascending: true })
      .range(offset, offset + effectiveLimit - 1);

    const { data, error, count } = await query;
    if (error) {
      return createSkillResult({
        success: false,
        errorCode: 'LIST_PLAYERS_ORG_FAILED',
        errorMessage: error.message,
      });
    }

    const processed = (data || []).map(p => {
      const { active_roster, club, ...playerData } = p;
      const clubObj = Array.isArray(club) ? club[0] : club;
      const rosterObj = Array.isArray(active_roster)
        ? active_roster.find(r => r.status === status) || active_roster[0]
        : active_roster;

      return {
        ...playerData,
        club_name: clubObj?.name || null,
        club_folio: rosterObj?.club_folio ?? p.club_folio ?? null,
        status: rosterObj?.status || status || 'ACTIVE',
      };
    });

    const total = count ?? 0;
    const hasMore = offset + effectiveLimit < total;
    const newToken = hasMore ? encodeNext(offset + effectiveLimit, effectiveLimit, { orgId }) : null;

    return createSkillResult({
      success: true,
      data: {
        data: processed,
        next_token: newToken,
        total_registros: total,
        limit: effectiveLimit,
      },
    });
  }

  async _updatePlayer({ playerId, ...updates }, db) {
    const allowed = [
      'first_name', 'last_name', 'birth_date', 'address',
      'phone', 'email', 'position', 'category_id', 'photo_url',
    ];
    const patch = Object.fromEntries(
      Object.entries(updates)
        .filter(([k]) => allowed.includes(k))
        .map(([k, v]) => [k, v === '' ? null : v])
    );

    if (Object.keys(patch).length === 0) {
      return createSkillResult({ success: false, errorCode: 'NO_FIELDS', errorMessage: 'No hay campos válidos para actualizar' });
    }

    const { data: player, error } = await db
      .from('lg_players')
      .update(patch)
      .eq('id', playerId)
      .select()
      .single();

    if (error) return createSkillResult({ success: false, errorCode: 'UPDATE_PLAYER_FAILED', errorMessage: error.message });

    return createSkillResult({ success: true, data: { player } });
  }

  async _updateStatus({ playerId, clubId, status }, db, userId) {
    const accessError = await this._assertClubAccess(clubId, userId, db);
    if (accessError) {
      return createSkillResult({ success: false, errorCode: accessError, errorMessage: 'No tienes permisos para modificar jugadores en este club' });
    }

    const { data: roster, error } = await db
      .from('lg_club_rosters')
      .update({ status })
      .eq('player_id', playerId)
      .eq('club_id', clubId)
      .select()
      .single();

    if (error) return createSkillResult({ success: false, errorCode: 'UPDATE_STATUS_FAILED', errorMessage: error.message });

    return createSkillResult({ success: true, data: { roster } });
  }

  async _changeClub({ playerId, fromClubId, toClubId }, db, userId) {
    // Si fromClubId no viene en el payload, lo resolvemos desde el roster activo
    let originClubId = fromClubId;
    if (!originClubId) {
      const { data: activeRoster } = await db
        .from('lg_club_rosters')
        .select('club_id')
        .eq('player_id', playerId)
        .eq('status', 'ACTIVE')
        .maybeSingle();
      if (!activeRoster) {
        return createSkillResult({
          success: false,
          errorCode: 'PLAYER_NOT_ACTIVE',
          errorMessage: 'El jugador no tiene un roster activo',
        });
      }
      originClubId = activeRoster.club_id;
    }

    const accessError = await this._assertClubAccess(originClubId, userId, db);
    if (accessError) {
      return createSkillResult({ success: false, errorCode: accessError, errorMessage: 'No tienes permisos para traspasar jugadores de este club' });
    }

    // 1. Desactivar roster en club origen (libera el folio)
    const { error: deactivateErr } = await db
      .from('lg_club_rosters')
      .update({ status: 'INACTIVE', valid_to: new Date().toISOString() })
      .eq('player_id', playerId)
      .eq('club_id', originClubId)
      .eq('status', 'ACTIVE');

    if (deactivateErr) {
      return createSkillResult({ success: false, errorCode: 'DEACTIVATE_ROSTER_FAILED', errorMessage: deactivateErr.message });
    }

    // 2. Resolver folio libre en club destino
    const folioResult = await this._resolveClubFolio(toClubId, undefined, db);
    if (folioResult.error) {
      // Revertir desactivación
      await db.from('lg_club_rosters')
        .update({ status: 'ACTIVE', valid_to: null })
        .eq('player_id', playerId)
        .eq('club_id', originClubId);
      return createSkillResult({ success: false, errorCode: folioResult.error.code, errorMessage: folioResult.error.message });
    }
    const { assignedFolio } = folioResult;

    // 3. Crear roster activo en club destino con folio asignado
    const { data: newRoster, error: activateErr } = await db
      .from('lg_club_rosters')
      .insert({
        club_id:    toClubId,
        player_id:  playerId,
        status:     'ACTIVE',
        valid_from: new Date().toISOString(),
        club_folio: assignedFolio,
      })
      .select()
      .single();

    if (activateErr) {
      // Revertir desactivación
      await db.from('lg_club_rosters')
        .update({ status: 'ACTIVE', valid_to: null })
        .eq('player_id', playerId)
        .eq('club_id', originClubId);
      return createSkillResult({ success: false, errorCode: 'ACTIVATE_ROSTER_FAILED', errorMessage: activateErr.message });
    }

    // 4. Actualizar club_folio en lg_players
    await db.from('lg_players')
      .update({ club_id: toClubId, club_folio: assignedFolio })
      .eq('id', playerId);

    return createSkillResult({ success: true, data: { roster: newRoster, fromClubId: originClubId, toClubId, assignedFolio } });
  }

  async _uploadPhoto({ playerId, photoUrl }, db) {
    if (!photoUrl) {
      return createSkillResult({ success: false, errorCode: 'MISSING_PHOTO_URL', errorMessage: 'photo_url es requerido' });
    }

    const { data: player, error } = await db
      .from('lg_players')
      .update({ photo_url: photoUrl })
      .eq('id', playerId)
      .select()
      .single();

    if (error) {
      return createSkillResult({ success: false, errorCode: 'UPLOAD_PHOTO_FAILED', errorMessage: error.message });
    }

    return createSkillResult({ success: true, data: { player } });
  }
}
