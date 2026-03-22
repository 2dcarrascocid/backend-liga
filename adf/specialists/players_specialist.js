/**
 * ADF - Players Specialist (Specialists Layer)
 *
 * Ejecuta operaciones del dominio de jugadores.
 * Maneja: creación, búsqueda, actualización, cambio de club, estado.
 *
 * DO:
 *   - Operar sobre lg_players y lg_club_rosters
 *   - En CREATE_PLAYER: crear jugador Y roster activo en una operación atómica
 *   - En CHANGE_CLUB: desactivar roster actual y activar en nuevo club
 *   - Incluir roster activo en respuestas de detalle de jugador
 *
 * DON'T:
 *   - No manejar préstamos/transfers — usar LoansSpecialist
 *   - No modificar la tabla de auth.users
 *   - No lanzar excepciones no controladas
 *
 * Capabilities:
 *   CREATE_PLAYER | GET_PLAYER | LIST_PLAYERS_BY_CLUB | LIST_PLAYERS_BY_ORG |
 *   UPDATE_PLAYER | UPDATE_STATUS | CHANGE_CLUB
 *
 * Checklist:
 *   [ ] ¿CREATE crea jugador Y roster en una sola operación?
 *   [ ] ¿CHANGE_CLUB desactiva el roster anterior?
 *   [ ] ¿Los listados incluyen paginación?
 *   [ ] ¿Se retorna el roster activo en GET_PLAYER?
 */

import { Skill } from '../contracts/skill_contract.js';
import { createSkillResult } from '../contracts/task_schema.js';

const CAPABILITIES = [
  'CREATE_PLAYER', 'GET_PLAYER',
  'LIST_PLAYERS_BY_CLUB', 'LIST_PLAYERS_BY_ORG',
  'UPDATE_PLAYER', 'UPDATE_STATUS', 'CHANGE_CLUB',
];

export class PlayersSpecialist extends Skill {
  constructor() {
    super('players_specialist', '1.0.0');
    this.domain = 'players';
    this.capabilities = CAPABILITIES;

    this.contract = {
      input: [
        { name: 'operation', required: true, type: 'string' },
        { name: 'payload', required: true, type: 'object' },
        { name: 'db', required: true, type: 'object' },
        { name: 'userId', required: false, type: 'string' },
      ],
      output: [
        { name: 'player', type: 'object' },
        { name: 'players', type: 'array' },
        { name: 'roster', type: 'object' },
        { name: 'nextToken', type: 'string' },
      ],
      rules: {
        do: [
          'Crear roster activo junto con el jugador en CREATE_PLAYER',
          'Desactivar roster anterior en CHANGE_CLUB',
          'Incluir roster activo en GET_PLAYER',
          'Buscar con ilike en listados con query param',
        ],
        dont: [
          'No manejar préstamos (usar LoansSpecialist)',
          'No modificar auth.users',
        ],
      },
      checklist: [
        'CREATE_PLAYER crea jugador y roster en secuencia',
        'CHANGE_CLUB desactiva roster previo',
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
        case 'CREATE_PLAYER':         return this._createPlayer(payload, db);
        case 'GET_PLAYER':            return this._getPlayer(payload, db);
        case 'LIST_PLAYERS_BY_CLUB':  return this._listByClub(payload, db);
        case 'LIST_PLAYERS_BY_ORG':   return this._listByOrg(payload, db);
        case 'UPDATE_PLAYER':         return this._updatePlayer(payload, db);
        case 'UPDATE_STATUS':         return this._updateStatus(payload, db);
        case 'CHANGE_CLUB':           return this._changeClub(payload, db, userId);
      }
    } catch (err) {
      return createSkillResult({
        success: false,
        errorCode: 'PLAYERS_SPECIALIST_ERROR',
        errorMessage: err.message,
      });
    }
  }

  async _createPlayer(payload, db) {
    const {
      orgId, clubId,
      firstName, lastName, nationalId, birthDate,
      address, phone, email, jerseyNumber, position, categoryId,
    } = payload;

    // Step 1: Insert player
    const { data: player, error: playerErr } = await db
      .from('lg_players')
      .insert({
        org_id: orgId,
        first_name: firstName,
        last_name: lastName,
        national_id: nationalId,
        birth_date: birthDate,
        address,
        phone,
        email,
        jersey_number: jerseyNumber,
        position,
        category_id: categoryId,
      })
      .select()
      .single();

    if (playerErr) {
      const isDuplicate = playerErr.code === '23505';
      return createSkillResult({
        success: false,
        errorCode: isDuplicate ? 'DUPLICATE_NATIONAL_ID' : 'CREATE_PLAYER_FAILED',
        errorMessage: isDuplicate ? `Ya existe un jugador con national_id "${nationalId}"` : playerErr.message,
      });
    }

    // Step 2: Create active roster entry
    const { data: roster, error: rosterErr } = await db
      .from('lg_club_rosters')
      .insert({ club_id: clubId, player_id: player.id, status: 'ACTIVE' })
      .select()
      .single();

    if (rosterErr) {
      // Rollback player creation
      await db.from('lg_players').delete().eq('id', player.id);
      return createSkillResult({
        success: false,
        errorCode: 'CREATE_ROSTER_FAILED',
        errorMessage: rosterErr.message,
      });
    }

    return createSkillResult({ success: true, data: { player, roster } });
  }

  async _getPlayer({ playerId }, db) {
    const { data: player, error } = await db
      .from('lg_players')
      .select('*, lg_club_rosters!inner(id, club_id, status, club_folio, valid_from, valid_to, lg_clubs(id, name))')
      .eq('id', playerId)
      .eq('lg_club_rosters.status', 'ACTIVE')
      .maybeSingle();

    if (error) return createSkillResult({ success: false, errorCode: 'GET_PLAYER_FAILED', errorMessage: error.message });
    if (!player) return createSkillResult({ success: false, errorCode: 'PLAYER_NOT_FOUND', errorMessage: 'Jugador no encontrado' });

    return createSkillResult({ success: true, data: { player } });
  }

  async _listByClub({ clubId, q, status, limit = 20 }, db) {
    let query = db
      .from('lg_club_rosters')
      .select('id, status, club_folio, valid_from, valid_to, lg_players(id, first_name, last_name, national_id, position, jersey_number, photo_url)')
      .eq('club_id', clubId)
      .order('club_folio')
      .limit(limit);

    if (status) query = query.eq('status', status);

    if (q) {
      query = query.or(
        `lg_players.first_name.ilike.%${q}%,lg_players.last_name.ilike.%${q}%,lg_players.national_id.ilike.%${q}%`
      );
    }

    const { data: players, error } = await query;
    if (error) return createSkillResult({ success: false, errorCode: 'LIST_PLAYERS_FAILED', errorMessage: error.message });

    return createSkillResult({ success: true, data: { players } });
  }

  async _listByOrg({ orgId, limit = 50 }, db) {
    const { data: players, error } = await db
      .from('lg_players')
      .select('*, lg_club_rosters(id, club_id, status, club_folio, lg_clubs(id, name))')
      .eq('org_id', orgId)
      .eq('lg_club_rosters.status', 'ACTIVE')
      .limit(limit);

    if (error) return createSkillResult({ success: false, errorCode: 'LIST_PLAYERS_ORG_FAILED', errorMessage: error.message });

    return createSkillResult({ success: true, data: { players } });
  }

  async _updatePlayer({ playerId, ...updates }, db) {
    const allowed = ['first_name', 'last_name', 'birth_date', 'address', 'phone', 'email',
      'jersey_number', 'position', 'category_id', 'photo_url'];
    const patch = Object.fromEntries(
      Object.entries(updates).filter(([k]) => allowed.includes(k))
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

  async _updateStatus({ playerId, clubId, status }, db) {
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

  async _changeClub({ playerId, fromClubId, toClubId }, db) {
    // Step 1: Deactivate in current club
    const { error: deactivateErr } = await db
      .from('lg_club_rosters')
      .update({ status: 'INACTIVE', valid_to: new Date().toISOString() })
      .eq('player_id', playerId)
      .eq('club_id', fromClubId)
      .eq('status', 'ACTIVE');

    if (deactivateErr) {
      return createSkillResult({
        success: false,
        errorCode: 'DEACTIVATE_ROSTER_FAILED',
        errorMessage: deactivateErr.message,
      });
    }

    // Step 2: Activate in new club
    const { data: newRoster, error: activateErr } = await db
      .from('lg_club_rosters')
      .insert({ club_id: toClubId, player_id: playerId, status: 'ACTIVE' })
      .select()
      .single();

    if (activateErr) {
      // Revert deactivation
      await db
        .from('lg_club_rosters')
        .update({ status: 'ACTIVE', valid_to: null })
        .eq('player_id', playerId)
        .eq('club_id', fromClubId);

      return createSkillResult({
        success: false,
        errorCode: 'ACTIVATE_ROSTER_FAILED',
        errorMessage: activateErr.message,
      });
    }

    return createSkillResult({ success: true, data: { roster: newRoster, fromClubId, toClubId } });
  }
}
