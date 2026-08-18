/**
 * ADF - Club Series Specialist (Specialists Layer)
 *
 * Gestión de Series por Equipo/Club (Serie Honor, Serie A, Senior, etc.):
 * CRUD de series y asignación/desasignación de jugadores del roster
 * del club a una serie específica. La Serie es la entidad que se
 * inscribe y compite en un torneo (ver tournaments_specialist.js).
 *
 * DO:
 *   - Operar sobre lg_club_series y el campo series_id de lg_club_rosters
 *   - Verificar que el roster del jugador pertenece al club de la serie
 *     antes de asignar
 *
 * DON'T:
 *   - No crear registros de roster (usar clubs_specialist.ADD_ROSTER) —
 *     este specialist solo asigna/desasigna el series_id de un roster existente
 *   - No gestionar inscripción a torneos (eso es de tournaments_specialist.js)
 *
 * Capabilities:
 *   LIST_SERIES | GET_SERIES | CREATE_SERIES | UPDATE_SERIES | DELETE_SERIES
 *   ASSIGN_PLAYER | UNASSIGN_PLAYER | GET_SERIES_ROSTER
 */

import { Skill } from '../contracts/skill_contract.js';
import { createSkillResult } from '../contracts/task_schema.js';
import { assertClubAccess } from './lib/club_access.js';

const CAPABILITIES = [
  'LIST_SERIES', 'GET_SERIES', 'CREATE_SERIES', 'UPDATE_SERIES', 'DELETE_SERIES',
  'ASSIGN_PLAYER', 'UNASSIGN_PLAYER', 'GET_SERIES_ROSTER',
];

const SERIES_SELECT = '*, club:lg_clubs(id,name,short_name,logo_url,org_id)';

// Edad cumplida: años reales, considerando si ya pasó el cumpleaños de este año.
function exactAge(birthDate) {
  const b = new Date(birthDate);
  const today = new Date();
  let age = today.getFullYear() - b.getFullYear();
  const hadBirthdayThisYear = today.getMonth() > b.getMonth()
    || (today.getMonth() === b.getMonth() && today.getDate() >= b.getDate());
  if (!hadBirthdayThisYear) age--;
  return age;
}

// Edad por año de nacimiento: categoría, sin exigir cumpleaños ya pasado.
function ageByBirthYear(birthDate) {
  return new Date().getFullYear() - new Date(birthDate).getFullYear();
}

// Calcula la edad de un jugador según el modo de restricción configurado en la serie.
function computePlayerAge(birthDate, ageRestriction) {
  if (!birthDate) return null;
  return ageRestriction ? exactAge(birthDate) : ageByBirthYear(birthDate);
}

export class ClubSeriesSpecialist extends Skill {
  constructor() {
    super('club_series_specialist', '1.0.0');
    this.domain = 'club_series';
    this.capabilities = CAPABILITIES;

    this.contract = {
      input: [
        { name: 'operation', required: true, type: 'string' },
        { name: 'payload', required: true, type: 'object' },
        { name: 'db', required: true, type: 'object' },
        { name: 'userId', required: false, type: 'string' },
      ],
      output: [
        { name: 'series', type: 'object' },
        { name: 'seriesList', type: 'array' },
        { name: 'roster', type: 'array' },
      ],
      rules: {
        do: [
          'Verificar que el roster pertenece al club de la serie antes de asignar',
          'Filtrar LIST_SERIES por clubId u orgId',
        ],
        dont: [
          'No crear registros de roster — solo asignar/desasignar series_id',
          'No gestionar inscripción a torneos',
        ],
      },
      checklist: [
        'CREATE_SERIES valida clubId/name',
        'minAge, si viene, es un entero entre 1 y 100 (constraint lg_club_series_min_age_check)',
        'ageRestriction=true exige edad cumplida (edad real >= minAge); false calcula elegibilidad por año de nacimiento parametrizado en minAge',
        'ASSIGN_PLAYER verifica que el jugador tiene roster ACTIVE en el club de la serie',
        'ASSIGN_PLAYER rechaza con AGE_NOT_ELIGIBLE si la edad del jugador (calculada según age_restriction) es menor a min_age de la serie',
        'ASSIGN_PLAYER setea series_status = INSCRITO; UNASSIGN_PLAYER lo limpia junto con series_id (no toca el status ACTIVE/INACTIVE del roster del club)',
        'DELETE_SERIES no rompe partidos ya jugados (FK ON DELETE SET NULL en lg_matches)',
      ],
    };
  }

  async execute(task) {
    const { operation, payload, db, userId } = task.input;

    if (!this.capabilities.includes(operation)) {
      return createSkillResult({ success: false, errorCode: 'UNKNOWN_OPERATION', errorMessage: `Operación desconocida: "${operation}"` });
    }

    try {
      switch (operation) {
        case 'LIST_SERIES':        return this._listSeries(payload, db, userId);
        case 'GET_SERIES':         return this._getSeries(payload, db, userId);
        case 'CREATE_SERIES':      return this._createSeries(payload, db, userId);
        case 'UPDATE_SERIES':      return this._updateSeries(payload, db, userId);
        case 'DELETE_SERIES':      return this._deleteSeries(payload, db, userId);
        case 'ASSIGN_PLAYER':      return this._assignPlayer(payload, db, userId);
        case 'UNASSIGN_PLAYER':    return this._unassignPlayer(payload, db, userId);
        case 'GET_SERIES_ROSTER':  return this._getSeriesRoster(payload, db, userId);
      }
    } catch (err) {
      return createSkillResult({ success: false, errorCode: 'CLUB_SERIES_SPECIALIST_ERROR', errorMessage: err.message });
    }
  }

  async _listSeries({ clubId, orgId, q, limit = 50 }, db, userId) {
    if (!clubId && !orgId) {
      return createSkillResult({ success: false, errorCode: 'MISSING_FIELDS', errorMessage: 'clubId u orgId es requerido' });
    }

    let query = db.from('lg_club_series').select(SERIES_SELECT).order('name', { ascending: true }).limit(limit);

    if (clubId) {
      const accessError = await assertClubAccess(clubId, userId, db);
      if (accessError) {
        return createSkillResult({ success: false, errorCode: accessError, errorMessage: 'No tienes permisos para ver las series de este club' });
      }
      query = query.eq('club_id', clubId);
    } else {
      // Búsqueda global por organización — solo para ADMIN de organización
      // (se usa en el selector de participantes al armar un torneo).
      const { data: orgAdmin } = await db
        .from('lg_org_users').select('role')
        .eq('user_id', userId).eq('org_id', orgId).maybeSingle();

      if (orgAdmin?.role !== 'ADMIN') {
        return createSkillResult({ success: false, errorCode: 'FORBIDDEN', errorMessage: 'Solo el ADMIN de la organización puede buscar series de todos los clubes' });
      }

      query = db.from('lg_club_series').select('*, club:lg_clubs!inner(id,name,short_name,logo_url,org_id)')
        .eq('club.org_id', orgId)
        .order('name', { ascending: true })
        .limit(limit);
    }

    if (q) query = query.ilike('name', `%${q}%`);

    const { data: seriesList, error } = await query;
    if (error) return createSkillResult({ success: false, errorCode: 'LIST_SERIES_FAILED', errorMessage: error.message });

    return createSkillResult({ success: true, data: { seriesList } });
  }

  async _getSeries({ seriesId }, db, userId) {
    const { data: series, error } = await db.from('lg_club_series').select(SERIES_SELECT).eq('id', seriesId).maybeSingle();
    if (error || !series) {
      return createSkillResult({ success: false, errorCode: 'SERIES_NOT_FOUND', errorMessage: 'Serie no encontrada' });
    }

    const accessError = await assertClubAccess(series.club_id, userId, db);
    if (accessError) {
      return createSkillResult({ success: false, errorCode: accessError, errorMessage: 'No tienes permisos para ver esta serie' });
    }

    return createSkillResult({ success: true, data: { series } });
  }

  async _createSeries({ clubId, name, description, categoryId, minAge, ageRestriction, active }, db, userId) {
    if (!clubId || !name) {
      return createSkillResult({ success: false, errorCode: 'MISSING_FIELDS', errorMessage: 'clubId y name son requeridos' });
    }

    const accessError = await assertClubAccess(clubId, userId, db);
    if (accessError) {
      return createSkillResult({ success: false, errorCode: accessError, errorMessage: 'No tienes permisos para crear series en este club' });
    }

    const { data: series, error } = await db
      .from('lg_club_series')
      .insert({
        club_id: clubId,
        name,
        description: description ?? null,
        category_id: categoryId ?? null,
        min_age: minAge ?? null,
        age_restriction: ageRestriction ?? false,
        active: active ?? true,
      })
      .select(SERIES_SELECT)
      .single();

    if (error) return createSkillResult({ success: false, errorCode: 'CREATE_SERIES_FAILED', errorMessage: error.message });
    return createSkillResult({ success: true, data: { series } });
  }

  async _updateSeries({ seriesId, name, description, categoryId, minAge, ageRestriction, active }, db, userId) {
    const { data: existing } = await db.from('lg_club_series').select('club_id').eq('id', seriesId).maybeSingle();
    if (!existing) {
      return createSkillResult({ success: false, errorCode: 'SERIES_NOT_FOUND', errorMessage: 'Serie no encontrada' });
    }

    const accessError = await assertClubAccess(existing.club_id, userId, db);
    if (accessError) {
      return createSkillResult({ success: false, errorCode: accessError, errorMessage: 'No tienes permisos para editar esta serie' });
    }

    const patch = { updated_at: new Date().toISOString() };
    if (name !== undefined) patch.name = name;
    if (description !== undefined) patch.description = description;
    if (categoryId !== undefined) patch.category_id = categoryId;
    if (minAge !== undefined) patch.min_age = minAge;
    if (ageRestriction !== undefined) patch.age_restriction = ageRestriction;
    if (active !== undefined) patch.active = active;

    const { data: series, error } = await db
      .from('lg_club_series').update(patch).eq('id', seriesId).select(SERIES_SELECT).single();

    if (error) return createSkillResult({ success: false, errorCode: 'UPDATE_SERIES_FAILED', errorMessage: error.message });
    return createSkillResult({ success: true, data: { series } });
  }

  async _deleteSeries({ seriesId }, db, userId) {
    const { data: existing } = await db.from('lg_club_series').select('id, club_id').eq('id', seriesId).maybeSingle();
    if (!existing) {
      return createSkillResult({ success: false, errorCode: 'SERIES_NOT_FOUND', errorMessage: 'Serie no encontrada' });
    }

    const accessError = await assertClubAccess(existing.club_id, userId, db);
    if (accessError) {
      return createSkillResult({ success: false, errorCode: accessError, errorMessage: 'No tienes permisos para eliminar esta serie' });
    }

    const { error } = await db.from('lg_club_series').delete().eq('id', seriesId);
    if (error) return createSkillResult({ success: false, errorCode: 'DELETE_SERIES_FAILED', errorMessage: error.message });

    return createSkillResult({ success: true, data: { deleted: true, seriesId } });
  }

  // ── Nómina por serie ─────────────────────────────────────────────────────

  async _getSeriesRoster({ seriesId }, db, userId) {
    const { data: series } = await db.from('lg_club_series').select('club_id').eq('id', seriesId).maybeSingle();
    if (!series) return createSkillResult({ success: false, errorCode: 'SERIES_NOT_FOUND', errorMessage: 'Serie no encontrada' });

    const accessError = await assertClubAccess(series.club_id, userId, db);
    if (accessError) {
      return createSkillResult({ success: false, errorCode: accessError, errorMessage: 'No tienes permisos para ver la nómina de esta serie' });
    }

    const { data: roster, error } = await db
      .from('lg_club_rosters')
      .select('*, player:lg_players(id,first_name,last_name,position,jersey_number,photo_url,birth_date)')
      .eq('series_id', seriesId)
      .eq('status', 'ACTIVE')
      .order('club_folio', { ascending: true, nullsFirst: false });

    if (error) return createSkillResult({ success: false, errorCode: 'GET_SERIES_ROSTER_FAILED', errorMessage: error.message });
    return createSkillResult({ success: true, data: { roster } });
  }

  async _assignPlayer({ seriesId, playerId }, db, userId) {
    if (!seriesId || !playerId) {
      return createSkillResult({ success: false, errorCode: 'MISSING_FIELDS', errorMessage: 'seriesId y playerId son requeridos' });
    }

    const { data: series } = await db.from('lg_club_series').select('club_id, min_age, age_restriction').eq('id', seriesId).maybeSingle();
    if (!series) return createSkillResult({ success: false, errorCode: 'SERIES_NOT_FOUND', errorMessage: 'Serie no encontrada' });

    const accessError = await assertClubAccess(series.club_id, userId, db);
    if (accessError) {
      return createSkillResult({ success: false, errorCode: accessError, errorMessage: 'No tienes permisos para asignar jugadores en este club' });
    }

    const { data: roster, error: rosterErr } = await db
      .from('lg_club_rosters')
      .select('id, player:lg_players(birth_date)')
      .eq('player_id', playerId)
      .eq('club_id', series.club_id)
      .eq('status', 'ACTIVE')
      .maybeSingle();

    if (rosterErr || !roster) {
      return createSkillResult({ success: false, errorCode: 'PLAYER_NOT_IN_CLUB', errorMessage: 'El jugador no tiene un roster activo en el club de esta serie' });
    }

    if (series.min_age) {
      const age = computePlayerAge(roster.player?.birth_date, series.age_restriction);
      if (age !== null && age < series.min_age) {
        const modo = series.age_restriction ? 'edad cumplida' : 'año de nacimiento';
        return createSkillResult({
          success: false,
          errorCode: 'AGE_NOT_ELIGIBLE',
          errorMessage: `El jugador no cumple la edad mínima de la serie (${series.min_age}, por ${modo}). Edad calculada: ${age}.`,
        });
      }
    }

    const { data: updated, error } = await db
      .from('lg_club_rosters')
      .update({ series_id: seriesId, series_status: 'INSCRITO', updated_at: new Date().toISOString() })
      .eq('id', roster.id)
      .select('*, player:lg_players(id,first_name,last_name,position,jersey_number,photo_url,birth_date)')
      .single();

    if (error) return createSkillResult({ success: false, errorCode: 'ASSIGN_PLAYER_FAILED', errorMessage: error.message });
    return createSkillResult({ success: true, data: { roster: updated } });
  }

  async _unassignPlayer({ seriesId, playerId }, db, userId) {
    const { data: series } = await db.from('lg_club_series').select('club_id').eq('id', seriesId).maybeSingle();
    if (!series) return createSkillResult({ success: false, errorCode: 'SERIES_NOT_FOUND', errorMessage: 'Serie no encontrada' });

    const accessError = await assertClubAccess(series.club_id, userId, db);
    if (accessError) {
      return createSkillResult({ success: false, errorCode: accessError, errorMessage: 'No tienes permisos para modificar jugadores en este club' });
    }

    const { data: updated, error } = await db
      .from('lg_club_rosters')
      .update({ series_id: null, series_status: null, updated_at: new Date().toISOString() })
      .eq('series_id', seriesId)
      .eq('player_id', playerId)
      .select('id')
      .maybeSingle();

    if (error) return createSkillResult({ success: false, errorCode: 'UNASSIGN_PLAYER_FAILED', errorMessage: error.message });
    if (!updated) return createSkillResult({ success: false, errorCode: 'ROSTER_NOT_FOUND', errorMessage: 'El jugador no está asignado a esta serie' });

    return createSkillResult({ success: true, data: { unassigned: true } });
  }
}
