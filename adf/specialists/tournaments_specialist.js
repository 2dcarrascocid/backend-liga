/**
 * ADF - Tournaments Specialist (Specialists Layer)
 *
 * Dominio de torneos/competencias: creación y administración de
 * torneos (Eliminación Directa, Todos contra Todos, Formatos Mixtos
 * y Liguilla/Ronda de Consuelo), inscripción de equipos, sorteo y
 * generación del fixture, y tabla de posiciones.
 *
 * DO:
 *   - Filtrar siempre por org_id en LIST_TOURNAMENTS
 *   - Delegar los algoritmos de sorteo a lib/fixture_generator.js (puro)
 *   - Delegar la propagación de ganador/perdedor de llave a lib/bracket_propagation.js
 *   - Dejar la logística y el resultado de cada partido a matches_specialist
 *
 * DON'T:
 *   - No gestionar logística ni resultados de partidos individuales — eso es de "matches"
 *   - No gestionar costos — eso es de "tournament_costs"
 *
 * Capabilities:
 *   LIST_TOURNAMENTS | GET_TOURNAMENT | CREATE_TOURNAMENT | UPDATE_TOURNAMENT | DELETE_TOURNAMENT
 *   LIST_TOURNAMENT_TEAMS | REGISTER_TEAM | UNREGISTER_TEAM
 *   LIST_STAGES | GENERATE_FIXTURE | GENERATE_KNOCKOUT_FROM_GROUPS | GENERATE_CONSOLATION
 *   GET_STANDINGS
 */

import { Skill } from '../contracts/skill_contract.js';
import { createSkillResult } from '../contracts/task_schema.js';
import { encodeNext, decodeNext } from '../../utils/pagination.js';
import { generateRoundRobin, generateGroups, generateKnockoutBracket } from './lib/fixture_generator.js';
import { propagateWinner } from './lib/bracket_propagation.js';

const CAPABILITIES = [
  'LIST_TOURNAMENTS', 'GET_TOURNAMENT', 'CREATE_TOURNAMENT', 'UPDATE_TOURNAMENT', 'DELETE_TOURNAMENT',
  'LIST_TOURNAMENT_TEAMS', 'REGISTER_TEAM', 'UNREGISTER_TEAM',
  'LIST_STAGES', 'GENERATE_FIXTURE', 'GENERATE_KNOCKOUT_FROM_GROUPS', 'GENERATE_CONSOLATION',
  'GET_STANDINGS',
];

const TOURNAMENT_UPDATABLE_FIELDS = {
  categoryId: 'category_id',
  name: 'name',
  season: 'season',
  status: 'status',
  startDate: 'start_date',
  endDate: 'end_date',
  roundsType: 'rounds_type',
  pointsWin: 'points_win',
  pointsDraw: 'points_draw',
  pointsLoss: 'points_loss',
  groupCount: 'group_count',
  teamsAdvancePerGroup: 'teams_advance_per_group',
  twoLeggedKnockout: 'two_legged_knockout',
  hasThirdPlaceMatch: 'has_third_place_match',
  hasConsolation: 'has_consolation',
  consolationName: 'consolation_name',
  notes: 'notes',
};

const ROUND_NAME_BY_DISTANCE = {
  1: 'Final',
  2: 'Semifinal',
  3: 'Cuartos de Final',
  4: 'Octavos de Final',
  5: 'Dieciseisavos de Final',
};

function roundName(roundIndex, totalRounds) {
  const distance = totalRounds - roundIndex;
  return ROUND_NAME_BY_DISTANCE[distance] || `Ronda ${roundIndex + 1}`;
}

function addDays(dateStr, days) {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export class TournamentsSpecialist extends Skill {
  constructor() {
    super('tournaments_specialist', '1.0.0');
    this.domain = 'tournaments';
    this.capabilities = CAPABILITIES;

    this.contract = {
      input: [
        { name: 'operation', required: true, type: 'string' },
        { name: 'payload', required: true, type: 'object' },
        { name: 'db', required: true, type: 'object' },
      ],
      output: [
        { name: 'tournament', type: 'object' },
        { name: 'tournaments', type: 'array' },
        { name: 'team', type: 'object' },
        { name: 'teams', type: 'array' },
        { name: 'stages', type: 'array' },
        { name: 'standings', type: 'array' },
      ],
      rules: {
        do: [
          'Filtrar siempre por org_id en LIST_TOURNAMENTS',
          'Usar fixture_generator.js para todo algoritmo de sorteo',
          'Usar bracket_propagation.js para avanzar ganadores/perdedores de llave',
        ],
        dont: [
          'No gestionar logística/resultados de partidos individuales',
          'No gestionar costos',
        ],
      },
      checklist: [
        'CREATE_TOURNAMENT valida orgId/name/format',
        'GENERATE_FIXTURE no duplica fixture ya generado',
        'GENERATE_KNOCKOUT_FROM_GROUPS siembra desde vw_tournament_standings',
      ],
    };
  }

  async execute(task) {
    const { operation, payload, db } = task.input;

    if (!this.capabilities.includes(operation)) {
      return createSkillResult({
        success: false,
        errorCode: 'UNKNOWN_OPERATION',
        errorMessage: `Operación desconocida: "${operation}"`,
      });
    }

    try {
      switch (operation) {
        case 'LIST_TOURNAMENTS': return this._listTournaments(payload, db);
        case 'GET_TOURNAMENT': return this._getTournament(payload, db);
        case 'CREATE_TOURNAMENT': return this._createTournament(payload, db);
        case 'UPDATE_TOURNAMENT': return this._updateTournament(payload, db);
        case 'DELETE_TOURNAMENT': return this._deleteTournament(payload, db);
        case 'LIST_TOURNAMENT_TEAMS': return this._listTeams(payload, db);
        case 'REGISTER_TEAM': return this._registerTeam(payload, db);
        case 'UNREGISTER_TEAM': return this._unregisterTeam(payload, db);
        case 'LIST_STAGES': return this._listStages(payload, db);
        case 'GENERATE_FIXTURE': return this._generateFixture(payload, db);
        case 'GENERATE_KNOCKOUT_FROM_GROUPS': return this._generateKnockoutFromGroups(payload, db);
        case 'GENERATE_CONSOLATION': return this._generateConsolation(payload, db);
        case 'GET_STANDINGS': return this._getStandings(payload, db);
      }
    } catch (err) {
      return createSkillResult({
        success: false,
        errorCode: 'TOURNAMENTS_SPECIALIST_ERROR',
        errorMessage: err.message,
      });
    }
  }

  // ── CRUD Torneo ─────────────────────────────────────────────────────────

  async _listTournaments({ orgId, status, categoryId, limit = 20, nextToken }, db) {
    if (!orgId) {
      return createSkillResult({ success: false, errorCode: 'MISSING_ORG', errorMessage: 'org_id es requerido' });
    }

    let offset = 0;
    let effectiveLimit = limit;
    if (nextToken) {
      const decoded = decodeNext(nextToken, { orgId });
      if (!decoded) {
        return createSkillResult({ success: false, errorCode: 'INVALID_NEXT_TOKEN', errorMessage: 'next_token inválido' });
      }
      offset = decoded.offset;
      effectiveLimit = decoded.limit;
    }

    let query = db.from('lg_tournaments').select('*', { count: 'exact' }).eq('org_id', orgId);
    if (status) query = query.eq('status', status);
    if (categoryId) query = query.eq('category_id', categoryId);
    query = query.order('created_at', { ascending: false }).range(offset, offset + effectiveLimit - 1);

    const { data: tournaments, error, count } = await query;
    if (error) {
      return createSkillResult({ success: false, errorCode: 'LIST_TOURNAMENTS_FAILED', errorMessage: error.message });
    }

    const total = count || 0;
    const hasMore = offset + effectiveLimit < total;
    const next = hasMore ? encodeNext(offset + effectiveLimit, effectiveLimit, { orgId }) : null;

    return createSkillResult({ success: true, data: { tournaments, nextToken: next, total } });
  }

  async _getTournament({ tournamentId }, db) {
    const { data: tournament, error } = await db
      .from('lg_tournaments').select('*').eq('id', tournamentId).maybeSingle();

    if (error || !tournament) {
      return createSkillResult({ success: false, errorCode: 'TOURNAMENT_NOT_FOUND', errorMessage: 'Torneo no encontrado' });
    }

    const { count: teamsCount } = await db
      .from('lg_tournament_teams').select('id', { count: 'exact', head: true }).eq('tournament_id', tournamentId);

    return createSkillResult({ success: true, data: { tournament: { ...tournament, teams_count: teamsCount ?? 0 } } });
  }

  async _createTournament(payload, db) {
    const { orgId, name, format } = payload;
    if (!orgId || !name || !format) {
      return createSkillResult({ success: false, errorCode: 'MISSING_FIELDS', errorMessage: 'org_id, name y format son requeridos' });
    }
    if (!['ROUND_ROBIN', 'KNOCKOUT', 'GROUPS_KNOCKOUT'].includes(format)) {
      return createSkillResult({ success: false, errorCode: 'INVALID_FORMAT', errorMessage: `Formato inválido: "${format}"` });
    }

    const { data: tournament, error } = await db
      .from('lg_tournaments')
      .insert({
        org_id: orgId,
        category_id: payload.categoryId ?? null,
        name,
        season: payload.season ?? null,
        format,
        status: payload.status ?? 'DRAFT',
        start_date: payload.startDate ?? null,
        end_date: payload.endDate ?? null,
        rounds_type: payload.roundsType ?? 'SINGLE',
        points_win: payload.pointsWin ?? 3,
        points_draw: payload.pointsDraw ?? 1,
        points_loss: payload.pointsLoss ?? 0,
        group_count: payload.groupCount ?? null,
        teams_advance_per_group: payload.teamsAdvancePerGroup ?? null,
        two_legged_knockout: payload.twoLeggedKnockout ?? false,
        has_third_place_match: payload.hasThirdPlaceMatch ?? false,
        has_consolation: payload.hasConsolation ?? false,
        consolation_name: payload.consolationName ?? 'Liguilla',
        notes: payload.notes ?? null,
      })
      .select()
      .single();

    if (error) {
      return createSkillResult({ success: false, errorCode: 'CREATE_TOURNAMENT_FAILED', errorMessage: error.message });
    }

    return createSkillResult({ success: true, data: { tournament } });
  }

  async _updateTournament({ tournamentId, ...updates }, db) {
    const patch = {};
    for (const [key, column] of Object.entries(TOURNAMENT_UPDATABLE_FIELDS)) {
      if (updates[key] !== undefined) patch[column] = updates[key];
      else if (updates[column] !== undefined) patch[column] = updates[column];
    }
    if (Object.keys(patch).length === 0) {
      return createSkillResult({ success: false, errorCode: 'NO_FIELDS', errorMessage: 'No hay campos válidos para actualizar' });
    }
    patch.updated_at = new Date().toISOString();

    const { data: tournament, error } = await db
      .from('lg_tournaments').update(patch).eq('id', tournamentId).select().single();

    if (error) {
      return createSkillResult({ success: false, errorCode: 'UPDATE_TOURNAMENT_FAILED', errorMessage: error.message });
    }
    return createSkillResult({ success: true, data: { tournament } });
  }

  async _deleteTournament({ tournamentId }, db) {
    const { data: existing } = await db.from('lg_tournaments').select('id').eq('id', tournamentId).maybeSingle();
    if (!existing) {
      return createSkillResult({ success: false, errorCode: 'TOURNAMENT_NOT_FOUND', errorMessage: 'Torneo no encontrado' });
    }
    const { error } = await db.from('lg_tournaments').delete().eq('id', tournamentId);
    if (error) {
      return createSkillResult({ success: false, errorCode: 'DELETE_TOURNAMENT_FAILED', errorMessage: error.message });
    }
    return createSkillResult({ success: true, data: { deleted: true, tournamentId } });
  }

  // ── Equipos inscritos ────────────────────────────────────────────────────

  async _listTeams({ tournamentId }, db) {
    const { data: teams, error } = await db
      .from('lg_tournament_teams')
      .select('*, series:lg_club_series(id,name,club:lg_clubs(id,name,short_name,logo_url))')
      .eq('tournament_id', tournamentId)
      .order('group_name', { ascending: true })
      .order('seed', { ascending: true, nullsFirst: false });

    if (error) {
      return createSkillResult({ success: false, errorCode: 'LIST_TEAMS_FAILED', errorMessage: error.message });
    }
    return createSkillResult({ success: true, data: { teams } });
  }

  async _registerTeam({ tournamentId, seriesId, groupName, seed }, db) {
    if (!tournamentId || !seriesId) {
      return createSkillResult({ success: false, errorCode: 'MISSING_FIELDS', errorMessage: 'tournamentId y seriesId son requeridos' });
    }

    const { data: team, error } = await db
      .from('lg_tournament_teams')
      .insert({
        tournament_id: tournamentId,
        series_id: seriesId,
        group_name: groupName ?? null,
        seed: seed ?? null,
      })
      .select('*, series:lg_club_series(id,name,club:lg_clubs(id,name,short_name,logo_url))')
      .single();

    if (error) {
      if (error.code === '23505') {
        return createSkillResult({ success: false, errorCode: 'DUPLICATE_TEAM', errorMessage: 'Esa serie ya está inscrita en este torneo' });
      }
      return createSkillResult({ success: false, errorCode: 'REGISTER_TEAM_FAILED', errorMessage: error.message });
    }
    return createSkillResult({ success: true, data: { team } });
  }

  async _unregisterTeam({ tournamentId, teamId }, db) {
    const { error } = await db
      .from('lg_tournament_teams').delete().eq('id', teamId).eq('tournament_id', tournamentId);
    if (error) {
      return createSkillResult({ success: false, errorCode: 'UNREGISTER_TEAM_FAILED', errorMessage: error.message });
    }
    return createSkillResult({ success: true, data: { deleted: true, teamId } });
  }

  // ── Fases ────────────────────────────────────────────────────────────────

  async _listStages({ tournamentId }, db) {
    const { data: stages, error } = await db
      .from('lg_tournament_stages').select('*').eq('tournament_id', tournamentId).order('stage_order', { ascending: true });
    if (error) {
      return createSkillResult({ success: false, errorCode: 'LIST_STAGES_FAILED', errorMessage: error.message });
    }
    return createSkillResult({ success: true, data: { stages } });
  }

  // ── Sorteo / Fixture ─────────────────────────────────────────────────────

  async _generateFixture({ tournamentId, startDate, daysBetweenMatchdays = 7, force = false }, db) {
    const { data: tournament, error: tErr } = await db.from('lg_tournaments').select('*').eq('id', tournamentId).maybeSingle();
    if (tErr || !tournament) {
      return createSkillResult({ success: false, errorCode: 'TOURNAMENT_NOT_FOUND', errorMessage: 'Torneo no encontrado' });
    }

    const { count: existingMatches } = await db
      .from('lg_matches').select('id', { count: 'exact', head: true }).eq('tournament_id', tournamentId);

    if (existingMatches > 0 && !force) {
      return createSkillResult({
        success: false,
        errorCode: 'FIXTURE_ALREADY_GENERATED',
        errorMessage: 'El fixture de este torneo ya fue generado. Use force=true para regenerarlo.',
      });
    }

    if (existingMatches > 0 && force) {
      await db.from('lg_tournament_stages').delete().eq('tournament_id', tournamentId);
    }

    const { data: teamRows, error: teamsErr } = await db
      .from('lg_tournament_teams').select('*').eq('tournament_id', tournamentId).order('seed', { ascending: true, nullsFirst: false });
    if (teamsErr) {
      return createSkillResult({ success: false, errorCode: 'LIST_TEAMS_FAILED', errorMessage: teamsErr.message });
    }
    if (!teamRows || teamRows.length < 2) {
      return createSkillResult({ success: false, errorCode: 'NOT_ENOUGH_TEAMS', errorMessage: 'Se requieren al menos 2 equipos inscritos' });
    }

    const teamIds = teamRows.map((t) => t.series_id);
    const effectiveStart = startDate ?? tournament.start_date ?? new Date().toISOString().slice(0, 10);

    let result;
    if (tournament.format === 'ROUND_ROBIN') {
      result = await this._buildRoundRobinStage(db, tournament, teamIds, effectiveStart, daysBetweenMatchdays);
    } else if (tournament.format === 'KNOCKOUT') {
      result = await this._buildKnockoutStage(db, tournament, teamIds, effectiveStart, daysBetweenMatchdays, { stageOrder: 1 });
    } else if (tournament.format === 'GROUPS_KNOCKOUT') {
      result = await this._buildGroupsStage(db, tournament, teamRows, effectiveStart, daysBetweenMatchdays);
    } else {
      return createSkillResult({ success: false, errorCode: 'INVALID_FORMAT', errorMessage: `Formato no soportado: ${tournament.format}` });
    }

    if (result.error) {
      return createSkillResult({ success: false, errorCode: result.errorCode || 'GENERATE_FIXTURE_FAILED', errorMessage: result.error });
    }

    await db.from('lg_tournaments').update({ status: 'IN_PROGRESS', updated_at: new Date().toISOString() }).eq('id', tournamentId);

    return createSkillResult({ success: true, data: { stages: result.stages, matchesCreated: result.matchesCreated } });
  }

  /** Todos contra Todos: una sola fase GROUP con round robin entre todos los inscritos. */
  async _buildRoundRobinStage(db, tournament, teamIds, startDate, daysBetweenMatchdays) {
    const { data: stage, error: stageErr } = await db
      .from('lg_tournament_stages')
      .insert({ tournament_id: tournament.id, name: 'Todos contra Todos', stage_type: 'GROUP', stage_order: 1, status: 'IN_PROGRESS' })
      .select().single();
    if (stageErr) return { error: stageErr.message };

    const rounds = generateRoundRobin(teamIds, { double: tournament.rounds_type === 'DOUBLE' });
    const { matchesCreated, error } = await this._insertRoundRobinRounds(db, tournament, stage, rounds, null, startDate, daysBetweenMatchdays);
    if (error) return { error };

    return { stages: [stage], matchesCreated };
  }

  /** Fase de grupos (GROUPS_KNOCKOUT paso 1) + fase de llave vacía a la espera del cierre de grupos. */
  async _buildGroupsStage(db, tournament, teamRows, startDate, daysBetweenMatchdays) {
    const groupCount = tournament.group_count || 2;
    const teamIds = teamRows.map((t) => t.series_id);
    const groups = generateGroups(teamIds, groupCount);

    const { data: groupStage, error: stageErr } = await db
      .from('lg_tournament_stages')
      .insert({ tournament_id: tournament.id, name: 'Fase de Grupos', stage_type: 'GROUP', stage_order: 1, status: 'IN_PROGRESS' })
      .select().single();
    if (stageErr) return { error: stageErr.message };

    // Persistir la asignación de grupo en cada equipo inscrito
    for (const group of groups) {
      for (const seriesId of group.teams) {
        await db.from('lg_tournament_teams')
          .update({ group_name: group.name })
          .eq('tournament_id', tournament.id).eq('series_id', seriesId);
      }
    }

    let matchesCreated = 0;
    for (const group of groups) {
      const rounds = generateRoundRobin(group.teams, { double: tournament.rounds_type === 'DOUBLE' });
      const result = await this._insertRoundRobinRounds(db, tournament, groupStage, rounds, group.name, startDate, daysBetweenMatchdays);
      if (result.error) return { error: result.error };
      matchesCreated += result.matchesCreated;
    }

    const { data: knockoutStage, error: koErr } = await db
      .from('lg_tournament_stages')
      .insert({ tournament_id: tournament.id, name: 'Playoffs', stage_type: 'KNOCKOUT', stage_order: 2, status: 'PENDING' })
      .select().single();
    if (koErr) return { error: koErr.message };

    return { stages: [groupStage, knockoutStage], matchesCreated };
  }

  /** Inserta las rondas de un round-robin (liga o grupo) creando una jornada por ronda. */
  async _insertRoundRobinRounds(db, tournament, stage, rounds, groupName, startDate, daysBetweenMatchdays) {
    let matchesCreated = 0;
    for (let i = 0; i < rounds.length; i++) {
      const roundPairs = rounds[i];
      if (roundPairs.length === 0) continue;

      const { data: matchday, error: mdErr } = await db
        .from('lg_matchdays')
        .insert({
          tournament_id: tournament.id,
          stage_id: stage.id,
          number: i + 1,
          name: groupName ? `Fecha ${i + 1} — Grupo ${groupName}` : `Fecha ${i + 1}`,
          date: addDays(startDate, i * daysBetweenMatchdays),
        })
        .select().single();
      if (mdErr) return { matchesCreated, error: `Error creando jornada ${i + 1}: ${mdErr.message}` };

      const rows = roundPairs.map((pair) => ({
        tournament_id: tournament.id,
        stage_id: stage.id,
        matchday_id: matchday.id,
        group_name: groupName,
        round_number: i + 1,
        home_series_id: pair.home,
        away_series_id: pair.away,
        status: 'SCHEDULED',
        match_date: matchday.date,
      }));

      const { data: inserted, error: matchErr } = await db.from('lg_matches').insert(rows).select('id');
      if (matchErr) return { matchesCreated, error: `Error creando partidos de la jornada ${i + 1}: ${matchErr.message}` };
      matchesCreated += inserted?.length || 0;
    }
    return { matchesCreated };
  }

  /**
   * Eliminación Directa: crea UNA fase KNOCKOUT con todas las rondas del
   * cuadro. Cada ronda se agrupa en su propia jornada. Los byes se insertan
   * como partidos WALKOVER ya resueltos y se propagan de inmediato.
   */
  async _buildKnockoutStage(db, tournament, seededTeamIds, startDate, daysBetweenMatchdays, { stageOrder, existingStage } = {}) {
    const bracket = generateKnockoutBracket(seededTeamIds, {
      twoLegged: tournament.two_legged_knockout,
      thirdPlace: tournament.has_third_place_match,
    });

    let stage = existingStage;
    if (!stage) {
      const { data: created, error: stageErr } = await db
        .from('lg_tournament_stages')
        .insert({
          tournament_id: tournament.id, name: 'Playoffs', stage_type: 'KNOCKOUT',
          stage_order: stageOrder ?? 1, bracket_size: bracket.bracketSize, status: 'IN_PROGRESS',
        })
        .select().single();
      if (stageErr) return { error: stageErr.message };
      stage = created;
    } else {
      await db.from('lg_tournament_stages')
        .update({ bracket_size: bracket.bracketSize, status: 'IN_PROGRESS' }).eq('id', stage.id);
    }

    // matchIdByRoundSlot[roundIndex][slot] = id del partido "decisivo" de ese cruce
    // (la vuelta si es ida/vuelta, o el único partido si es a partido único).
    const matchIdByRoundSlot = [];
    const totalRounds = bracket.rounds.length;
    let matchesCreated = 0;
    const finishedBecauseOfBye = [];

    for (let r = 0; r < bracket.rounds.length; r++) {
      matchIdByRoundSlot[r] = {};
      const { data: matchday, error: mdErr } = await db
        .from('lg_matchdays')
        .insert({
          tournament_id: tournament.id, stage_id: stage.id, number: r + 1,
          name: roundName(r, totalRounds), date: addDays(startDate, r * daysBetweenMatchdays),
        })
        .select().single();
      if (mdErr) return { error: mdErr.message };

      for (const slotDef of bracket.rounds[r]) {
        const homeSourceId = slotDef.homeSourceSlot ? matchIdByRoundSlot[slotDef.homeSourceSlot.roundIndex]?.[slotDef.homeSourceSlot.slot] : null;
        const awaySourceId = slotDef.awaySourceSlot ? matchIdByRoundSlot[slotDef.awaySourceSlot.roundIndex]?.[slotDef.awaySourceSlot.slot] : null;

        const legIds = [];
        for (const legNumber of slotDef.legs) {
          const isSecondLeg = legNumber === 2;
          const base = {
            tournament_id: tournament.id,
            stage_id: stage.id,
            matchday_id: matchday.id,
            round_number: r + 1,
            leg_number: legNumber,
            home_series_id: isSecondLeg ? slotDef.awayTeamId : slotDef.homeTeamId,
            away_series_id: isSecondLeg ? slotDef.homeTeamId : slotDef.awayTeamId,
            home_source_match_id: isSecondLeg ? awaySourceId : homeSourceId,
            away_source_match_id: isSecondLeg ? homeSourceId : awaySourceId,
            match_date: matchday.date,
          };

          if (slotDef.isBye) {
            base.status = 'WALKOVER';
            base.winner_series_id = slotDef.homeTeamId;
          } else {
            base.status = 'SCHEDULED';
          }

          const { data: match, error: matchErr } = await db.from('lg_matches').insert(base).select().single();
          if (matchErr) return { error: matchErr.message };
          matchesCreated++;
          legIds.push(match);
        }

        // El partido "decisivo" del cruce es la última pierna (vuelta si aplica).
        const decisive = legIds[legIds.length - 1];
        matchIdByRoundSlot[r][slotDef.slot] = decisive.id;
        if (slotDef.isBye) finishedBecauseOfBye.push(decisive);
      }
    }

    // Partido por el 3er/4to lugar (perdedores de semifinal)
    if (bracket.thirdPlaceMatch) {
      const { roundIndex: semiR } = bracket.thirdPlaceMatch.homeSourceSlot;
      const homeSourceId = matchIdByRoundSlot[semiR]?.[bracket.thirdPlaceMatch.homeSourceSlot.slot];
      const awaySourceId = matchIdByRoundSlot[semiR]?.[bracket.thirdPlaceMatch.awaySourceSlot.slot];

      const { data: lastMatchday } = await db
        .from('lg_matchdays').select('*').eq('stage_id', stage.id).order('number', { ascending: false }).limit(1).maybeSingle();

      await db.from('lg_matches').insert({
        tournament_id: tournament.id,
        stage_id: stage.id,
        matchday_id: lastMatchday?.id ?? null,
        round_number: totalRounds,
        leg_number: 1,
        home_source_match_id: homeSourceId,
        away_source_match_id: awaySourceId,
        home_source_is_loser: true,
        away_source_is_loser: true,
        status: 'SCHEDULED',
        match_date: lastMatchday?.date ?? null,
      });
      matchesCreated++;
    }

    // Propaga los byes ya resueltos hacia la ronda siguiente.
    for (const match of finishedBecauseOfBye) {
      await propagateWinner(db, match);
    }

    return { stages: [stage], matchesCreated };
  }

  async _generateKnockoutFromGroups({ tournamentId, stageId }, db) {
    const { data: tournament, error: tErr } = await db.from('lg_tournaments').select('*').eq('id', tournamentId).maybeSingle();
    if (tErr || !tournament) {
      return createSkillResult({ success: false, errorCode: 'TOURNAMENT_NOT_FOUND', errorMessage: 'Torneo no encontrado' });
    }

    const { data: groupStage } = await db
      .from('lg_tournament_stages').select('*').eq('tournament_id', tournamentId).eq('stage_type', 'GROUP')
      .order('stage_order', { ascending: false }).limit(1).maybeSingle();
    if (!groupStage) {
      return createSkillResult({ success: false, errorCode: 'STAGE_NOT_FOUND', errorMessage: 'No existe una fase de grupos para este torneo' });
    }

    let knockoutStage;
    if (stageId) {
      const { data } = await db.from('lg_tournament_stages').select('*').eq('id', stageId).maybeSingle();
      knockoutStage = data;
    } else {
      const { data } = await db.from('lg_tournament_stages').select('*').eq('tournament_id', tournamentId).eq('stage_type', 'KNOCKOUT')
        .order('stage_order', { ascending: false }).limit(1).maybeSingle();
      knockoutStage = data;
    }
    if (!knockoutStage) {
      return createSkillResult({ success: false, errorCode: 'STAGE_NOT_FOUND', errorMessage: 'No existe una fase de llave (KNOCKOUT) para sembrar' });
    }

    const { data: standings, error: standingsErr } = await db
      .from('vw_tournament_standings').select('*').eq('tournament_id', tournamentId).eq('stage_id', groupStage.id)
      .order('group_name', { ascending: true }).order('position', { ascending: true });
    if (standingsErr) {
      return createSkillResult({ success: false, errorCode: 'STANDINGS_FAILED', errorMessage: standingsErr.message });
    }
    if (!standings || standings.length === 0) {
      return createSkillResult({ success: false, errorCode: 'STANDINGS_EMPTY', errorMessage: 'La fase de grupos aún no tiene partidos finalizados' });
    }

    const advancePerGroup = tournament.teams_advance_per_group || 2;
    const byGroup = {};
    for (const row of standings) {
      const key = row.group_name || '_';
      byGroup[key] = byGroup[key] || [];
      byGroup[key].push(row);
    }
    const groupNames = Object.keys(byGroup).sort();

    // Sembrado cruzado: todos los 1ros lugares, luego todos los 2dos, etc.
    const seededTeamIds = [];
    const eliminatedSeriesIds = [];
    for (let rank = 0; rank < Math.max(...groupNames.map((g) => byGroup[g].length)); rank++) {
      for (const g of groupNames) {
        const row = byGroup[g][rank];
        if (!row) continue;
        if (rank < advancePerGroup) seededTeamIds.push(row.series_id);
        else eliminatedSeriesIds.push(row.series_id);
      }
    }

    if (seededTeamIds.length < 2) {
      return createSkillResult({ success: false, errorCode: 'NOT_ENOUGH_TEAMS', errorMessage: 'No hay suficientes equipos clasificados para armar la llave' });
    }

    const effectiveStart = tournament.start_date ?? new Date().toISOString().slice(0, 10);
    const result = await this._buildKnockoutStage(db, tournament, seededTeamIds, effectiveStart, 7, { existingStage: knockoutStage });
    if (result.error) {
      return createSkillResult({ success: false, errorCode: 'GENERATE_KNOCKOUT_FAILED', errorMessage: result.error });
    }

    await db.from('lg_tournament_stages').update({ status: 'FINISHED' }).eq('id', groupStage.id);
    for (const seriesId of eliminatedSeriesIds) {
      await db.from('lg_tournament_teams').update({ status: 'ELIMINATED' })
        .eq('tournament_id', tournamentId).eq('series_id', seriesId);
    }

    return createSkillResult({ success: true, data: { stage: result.stages[0], matchesCreated: result.matchesCreated, advanced: seededTeamIds, eliminated: eliminatedSeriesIds } });
  }

  async _generateConsolation({ tournamentId, teamIds }, db) {
    const { data: tournament, error: tErr } = await db.from('lg_tournaments').select('*').eq('id', tournamentId).maybeSingle();
    if (tErr || !tournament) {
      return createSkillResult({ success: false, errorCode: 'TOURNAMENT_NOT_FOUND', errorMessage: 'Torneo no encontrado' });
    }

    let seriesIds = teamIds;
    if (!seriesIds || seriesIds.length === 0) {
      const { data: eliminated } = await db
        .from('lg_tournament_teams').select('series_id').eq('tournament_id', tournamentId).eq('status', 'ELIMINATED');
      seriesIds = (eliminated || []).map((t) => t.series_id);
    }

    if (!seriesIds || seriesIds.length < 2) {
      return createSkillResult({ success: false, errorCode: 'NOT_ENOUGH_TEAMS', errorMessage: 'Se requieren al menos 2 equipos para la liguilla de consuelo' });
    }

    const { count: existingStages } = await db
      .from('lg_tournament_stages').select('id', { count: 'exact', head: true }).eq('tournament_id', tournamentId);

    const { data: stage, error: stageErr } = await db
      .from('lg_tournament_stages')
      .insert({
        tournament_id: tournamentId,
        name: tournament.consolation_name || 'Liguilla',
        stage_type: 'CONSOLATION',
        stage_order: (existingStages || 0) + 1,
        is_consolation: true,
        status: 'IN_PROGRESS',
      })
      .select().single();
    if (stageErr) {
      return createSkillResult({ success: false, errorCode: 'GENERATE_CONSOLATION_FAILED', errorMessage: stageErr.message });
    }

    const rounds = generateRoundRobin(seriesIds, { double: false });
    const effectiveStart = tournament.start_date ?? new Date().toISOString().slice(0, 10);
    const matchesCreated = await this._insertRoundRobinRounds(db, tournament, stage, rounds, null, effectiveStart, 7);

    return createSkillResult({ success: true, data: { stage, matchesCreated } });
  }

  // ── Tabla de posiciones ──────────────────────────────────────────────────

  async _getStandings({ tournamentId, stageId, groupName }, db) {
    if (!tournamentId) {
      return createSkillResult({ success: false, errorCode: 'MISSING_FIELDS', errorMessage: 'tournamentId es requerido' });
    }
    let query = db.from('vw_tournament_standings').select('*').eq('tournament_id', tournamentId);
    if (stageId) query = query.eq('stage_id', stageId);
    if (groupName) query = query.eq('group_name', groupName);
    query = query.order('stage_id', { ascending: true }).order('group_name', { ascending: true }).order('position', { ascending: true });

    const { data: standings, error } = await query;
    if (error) {
      return createSkillResult({ success: false, errorCode: 'STANDINGS_FAILED', errorMessage: error.message });
    }
    return createSkillResult({ success: true, data: { standings } });
  }
}
