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
 *   - Exigir season_id en CREATE_TOURNAMENT (todo torneo pertenece a una Temporada,
 *     gestionada por SeasonsSpecialist / lg_seasons) y validar que type sea
 *     AMISTOSO u OFICIAL
 *
 * DON'T:
 *   - No gestionar logística ni resultados de partidos individuales — eso es de "matches"
 *   - No gestionar gastos del organizador (arbitraje/cancha) — eso es de "tournament_costs"
 *   - No gestionar temporadas — eso es de "seasons" (SeasonsSpecialist)
 *
 * Autorización — CREATE_TOURNAMENT / UPDATE_TOURNAMENT / DELETE_TOURNAMENT:
 *   - RLS de todo el schema es USING(true) (ver migraciones) — la única
 *     barrera de autorización real es este specialist. security_validator.js
 *     solo exige un Bearer token de ALGÚN usuario autenticado, no resuelve
 *     rol/organización.
 *   - Gestionar la competencia en sí (crear/editar/borrar un torneo:
 *     formato, costo de inscripción, categoría, fechas, status) es dominio
 *     EXCLUSIVO del ADMIN de la organización dueña del torneo — isOrgAdmin(),
 *     nunca alcanza con ser ADMIN_CLUB. A diferencia de REGISTER_TEAM /
 *     REGISTER_CLUB (donde un admin de club actúa sobre SU club), acá se
 *     define la competencia para toda la organización.
 *   - UPDATE/DELETE resuelven el org_id del torneo EXISTENTE antes de
 *     autorizar (no confían en ningún org_id que venga en el payload).
 *
 * Inscripción de CLUB a un torneo (REGISTER_CLUB / UNREGISTER_CLUB /
 * LIST_TOURNAMENT_CLUBS) — paso previo, obligatorio, a inscribir una serie:
 *   - Un club se inscribe UNA vez por torneo (lg_tournament_clubs, gate
 *     previo a lg_tournament_teams).
 *   - Mismo criterio de permisos que REGISTER_TEAM (assertClubAccess),
 *     mismo gate de status REGISTRATION y temporada activa si quien
 *     inscribe no es admin de organización.
 *   - El club debe pertenecer a la MISMA organización que el torneo
 *     (club.org_id === tournament.org_id) — error CLUB_ORG_MISMATCH si no.
 *     assertClubAccess por sí sola NO alcanza para esto: solo valida que el
 *     usuario administre el club dentro de la org DEL CLUB, no que el club y
 *     el torneo compartan organización (mismo chequeo agregado en
 *     REGISTER_TEAM, que tenía el mismo hueco).
 *   - LIST_TOURNAMENT_CLUBS expone datos financieros (inscription_charge) —
 *     ADMIN de la organización ve todos los clubes inscritos; cualquier
 *     otro usuario solo ve los clubes a los que tiene acceso
 *     (getAccessibleClubIds, mismo patrón que club_finance_specialist.js).
 *   - Al inscribir el club se genera 1 cobro INSCRIPCION en el libro
 *     (lib/ledger.js) usando lg_tournaments.inscription_fee (costo propio
 *     del torneo, obligatorio en CREATE_TOURNAMENT) — UNA vez por club, no
 *     por serie. El estado pendiente/pagado se deriva de ese ledger entry
 *     (computeEntryStatus, calculado en runtime, sin columna de estado).
 *
 * Reglas de inscripción de SERIE (REGISTER_TEAM):
 *   - Solo puede inscribir quien tenga acceso al club dueño de la serie
 *     (assertClubAccess): admin de organización → cualquier club; admin de
 *     club → solo el suyo
 *   - El torneo debe estar en status REGISTRATION ("torneos disponibles")
 *   - Si quien inscribe NO es admin de organización, el torneo debe
 *     pertenecer a la temporada activa (lg_seasons.active = true)
 *   - El club dueño de la serie debe pertenecer a la MISMA organización que
 *     el torneo (club.org_id === tournament.org_id) — error
 *     CLUB_ORG_MISMATCH si no (ver nota de autorización arriba)
 *   - La categoría de la serie (lg_club_series.category_id) debe coincidir
 *     con la categoría del torneo (lg_tournaments.category_id) — si el
 *     torneo no tiene categoría definida (NULL) se omite la validación
 *   - El club dueño de la serie debe estar ya inscrito al torneo
 *     (lg_tournament_clubs) — error CLUB_NOT_REGISTERED si no
 *   - REGISTER_TEAM ya NO genera cobro propio (antes disparaba 1 cobro
 *     INSCRIPCION por serie); ese cobro ahora es responsabilidad exclusiva
 *     de REGISTER_CLUB, una sola vez por club. Cada fecha generada por el
 *     fixture sigue generando 1 cobro FECHA por cada serie ACTIVE inscrita
 *     — ver lib/ledger.js, dominio separado de "tournament_costs" (eso es
 *     gasto del organizador; esto es lo que el club le debe a la liga)
 *
 * Capabilities:
 *   LIST_TOURNAMENTS | GET_TOURNAMENT | CREATE_TOURNAMENT | UPDATE_TOURNAMENT | DELETE_TOURNAMENT
 *   LIST_TOURNAMENT_TEAMS | REGISTER_TEAM | UNREGISTER_TEAM
 *   LIST_TOURNAMENT_CLUBS | REGISTER_CLUB | UNREGISTER_CLUB
 *   LIST_STAGES | GENERATE_FIXTURE | GENERATE_KNOCKOUT_FROM_GROUPS | GENERATE_CONSOLATION
 *   GET_STANDINGS
 */

import { Skill } from '../contracts/skill_contract.js';
import { createSkillResult } from '../contracts/task_schema.js';
import { encodeNext, decodeNext } from '../../utils/pagination.js';
import { generateRoundRobin, generateGroups, generateKnockoutBracket } from './lib/fixture_generator.js';
import { propagateWinner } from './lib/bracket_propagation.js';
import { assertClubAccess, isOrgAdmin, getAccessibleClubIds } from './lib/club_access.js';
import { createInscriptionCharge, createMatchdayCharges, clearUnpaidMatchdayCharges, computeEntryStatus } from './lib/ledger.js';

const CAPABILITIES = [
  'LIST_TOURNAMENTS', 'GET_TOURNAMENT', 'CREATE_TOURNAMENT', 'UPDATE_TOURNAMENT', 'DELETE_TOURNAMENT',
  'LIST_TOURNAMENT_TEAMS', 'REGISTER_TEAM', 'UNREGISTER_TEAM',
  'LIST_TOURNAMENT_CLUBS', 'REGISTER_CLUB', 'UNREGISTER_CLUB',
  'LIST_STAGES', 'GENERATE_FIXTURE', 'GENERATE_KNOCKOUT_FROM_GROUPS', 'GENERATE_CONSOLATION',
  'GET_STANDINGS',
];

const TOURNAMENT_TYPES = ['AMISTOSO', 'OFICIAL'];

const TOURNAMENT_UPDATABLE_FIELDS = {
  categoryId: 'category_id',
  seasonId: 'season_id',
  name: 'name',
  type: 'type',
  status: 'status',
  inscriptionFee: 'inscription_fee',
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
        { name: 'userId', required: false, type: 'string' },
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
          'Exigir isOrgAdmin(userId, org_id) en CREATE/UPDATE/DELETE_TOURNAMENT — RLS es USING(true), la autorización real vive acá',
          'Validar club.org_id === tournament.org_id en REGISTER_TEAM y REGISTER_CLUB',
          'Filtrar LIST_TOURNAMENT_CLUBS por getAccessibleClubIds cuando el caller no es admin de la organización del torneo',
        ],
        dont: [
          'No gestionar logística/resultados de partidos individuales',
          'No gestionar costos',
          'No confiar en ningún org_id del payload para autorizar UPDATE/DELETE — resolver el org_id del recurso existente',
        ],
      },
      checklist: [
        'CREATE_TOURNAMENT valida orgId/name/format/inscriptionFee (>= 0) y isOrgAdmin(userId, orgId)',
        'UPDATE_TOURNAMENT y DELETE_TOURNAMENT resuelven el org_id del torneo existente y validan isOrgAdmin antes de aplicar el cambio',
        'GENERATE_FIXTURE no duplica fixture ya generado',
        'GENERATE_KNOCKOUT_FROM_GROUPS siembra desde vw_tournament_standings',
        'REGISTER_CLUB valida assertClubAccess, club.org_id === tournament.org_id, status REGISTRATION y temporada activa (si no es admin de org), y genera 1 cobro INSCRIPCION por club',
        'REGISTER_TEAM valida assertClubAccess, club.org_id === tournament.org_id, status REGISTRATION, temporada activa (si no es admin de org), categoría de la serie vs categoría del torneo, y que el club ya esté inscrito (lg_tournament_clubs)',
        'LIST_TOURNAMENT_CLUBS filtra por clubes accesibles (getAccessibleClubIds) cuando el caller no es admin de la organización del torneo',
        'Toda generación de matchdays llama _generateMatchdayCharges sin duplicar cobros existentes',
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
        case 'LIST_TOURNAMENTS': return this._listTournaments(payload, db);
        case 'GET_TOURNAMENT': return this._getTournament(payload, db);
        case 'CREATE_TOURNAMENT': return this._createTournament(payload, db, userId);
        case 'UPDATE_TOURNAMENT': return this._updateTournament(payload, db, userId);
        case 'DELETE_TOURNAMENT': return this._deleteTournament(payload, db, userId);
        case 'LIST_TOURNAMENT_TEAMS': return this._listTeams(payload, db);
        case 'REGISTER_TEAM': return this._registerTeam(payload, db, userId);
        case 'UNREGISTER_TEAM': return this._unregisterTeam(payload, db, userId);
        case 'LIST_TOURNAMENT_CLUBS': return this._listTournamentClubs(payload, db, userId);
        case 'REGISTER_CLUB': return this._registerClub(payload, db, userId);
        case 'UNREGISTER_CLUB': return this._unregisterClub(payload, db, userId);
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

  async _listTournaments({ orgId, status, categoryId, seasonId, type, limit = 20, nextToken }, db) {
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

    let query = db.from('lg_tournaments').select('*, season:lg_seasons(id,name,year), category:lg_categories(id,name,serie,gender,age_from,age_to)', { count: 'exact' }).eq('org_id', orgId);
    if (status) query = query.eq('status', status);
    if (categoryId) query = query.eq('category_id', categoryId);
    if (seasonId) query = query.eq('season_id', seasonId);
    if (type) query = query.eq('type', type);
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
      .from('lg_tournaments').select('*, season:lg_seasons(id,name,year), category:lg_categories(id,name,serie,gender,age_from,age_to)').eq('id', tournamentId).maybeSingle();

    if (error || !tournament) {
      return createSkillResult({ success: false, errorCode: 'TOURNAMENT_NOT_FOUND', errorMessage: 'Torneo no encontrado' });
    }

    const { count: teamsCount } = await db
      .from('lg_tournament_teams').select('id', { count: 'exact', head: true }).eq('tournament_id', tournamentId);

    return createSkillResult({ success: true, data: { tournament: { ...tournament, teams_count: teamsCount ?? 0 } } });
  }

  async _createTournament(payload, db, userId) {
    const { orgId, name, format, seasonId, categoryId, inscriptionFee } = payload;
    if (!orgId || !name || !format || !seasonId || !categoryId || inscriptionFee === undefined || inscriptionFee === null) {
      return createSkillResult({ success: false, errorCode: 'MISSING_FIELDS', errorMessage: 'org_id, name, format, seasonId, categoryId e inscriptionFee son requeridos' });
    }
    if (!['ROUND_ROBIN', 'KNOCKOUT', 'GROUPS_KNOCKOUT'].includes(format)) {
      return createSkillResult({ success: false, errorCode: 'INVALID_FORMAT', errorMessage: `Formato inválido: "${format}"` });
    }
    const inscriptionFeeNum = Number(inscriptionFee);
    if (!Number.isFinite(inscriptionFeeNum) || inscriptionFeeNum < 0) {
      return createSkillResult({ success: false, errorCode: 'INVALID_INSCRIPTION_FEE', errorMessage: 'inscriptionFee debe ser un número mayor o igual a 0' });
    }

    // Gestión de torneos (crear/editar/borrar) es dominio exclusivo del
    // ADMIN de la organización dueña del torneo — no de ADMIN_CLUB. A
    // diferencia de la inscripción (REGISTER_TEAM/REGISTER_CLUB), donde un
    // admin de club actúa sobre SU club, acá se está definiendo la
    // competencia en sí (formato, costo, categoría, fechas) para toda la org.
    if (!(await isOrgAdmin(userId, orgId, db))) {
      return createSkillResult({ success: false, errorCode: 'FORBIDDEN', errorMessage: 'Solo el administrador de la organización puede crear torneos' });
    }

    const type = payload.type ?? 'OFICIAL';
    if (!TOURNAMENT_TYPES.includes(type)) {
      return createSkillResult({ success: false, errorCode: 'INVALID_TYPE', errorMessage: `Tipo de torneo inválido: "${type}"` });
    }

    const { data: season } = await db
      .from('lg_seasons').select('id').eq('id', seasonId).eq('org_id', orgId).maybeSingle();
    if (!season) {
      return createSkillResult({ success: false, errorCode: 'SEASON_NOT_FOUND', errorMessage: 'La temporada indicada no existe en esta organización' });
    }

    const { data: category } = await db
      .from('lg_categories').select('id').eq('id', categoryId).eq('org_id', orgId).maybeSingle();
    if (!category) {
      return createSkillResult({ success: false, errorCode: 'CATEGORY_NOT_FOUND', errorMessage: 'La categoría indicada no existe en esta organización' });
    }

    const { data: tournament, error } = await db
      .from('lg_tournaments')
      .insert({
        org_id: orgId,
        category_id: categoryId,
        season_id: seasonId,
        name,
        type,
        format,
        status: payload.status ?? 'DRAFT',
        inscription_fee: inscriptionFeeNum,
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

  async _updateTournament({ tournamentId, ...updates }, db, userId) {
    const { data: existing } = await db.from('lg_tournaments').select('id, org_id').eq('id', tournamentId).maybeSingle();
    if (!existing) {
      return createSkillResult({ success: false, errorCode: 'TOURNAMENT_NOT_FOUND', errorMessage: 'Torneo no encontrado' });
    }
    if (!(await isOrgAdmin(userId, existing.org_id, db))) {
      return createSkillResult({ success: false, errorCode: 'FORBIDDEN', errorMessage: 'Solo el administrador de la organización puede editar torneos' });
    }

    const patch = {};
    for (const [key, column] of Object.entries(TOURNAMENT_UPDATABLE_FIELDS)) {
      if (updates[key] !== undefined) patch[column] = updates[key];
      else if (updates[column] !== undefined) patch[column] = updates[column];
    }
    if (Object.keys(patch).length === 0) {
      return createSkillResult({ success: false, errorCode: 'NO_FIELDS', errorMessage: 'No hay campos válidos para actualizar' });
    }
    if (patch.type !== undefined && !TOURNAMENT_TYPES.includes(patch.type)) {
      return createSkillResult({ success: false, errorCode: 'INVALID_TYPE', errorMessage: `Tipo de torneo inválido: "${patch.type}"` });
    }
    if (patch.inscription_fee !== undefined) {
      const feeNum = Number(patch.inscription_fee);
      if (!Number.isFinite(feeNum) || feeNum < 0) {
        return createSkillResult({ success: false, errorCode: 'INVALID_INSCRIPTION_FEE', errorMessage: 'inscriptionFee debe ser un número mayor o igual a 0' });
      }
      patch.inscription_fee = feeNum;
    }
    patch.updated_at = new Date().toISOString();

    const { data: tournament, error } = await db
      .from('lg_tournaments').update(patch).eq('id', tournamentId).select().single();

    if (error) {
      return createSkillResult({ success: false, errorCode: 'UPDATE_TOURNAMENT_FAILED', errorMessage: error.message });
    }
    return createSkillResult({ success: true, data: { tournament } });
  }

  async _deleteTournament({ tournamentId }, db, userId) {
    const { data: existing } = await db.from('lg_tournaments').select('id, org_id').eq('id', tournamentId).maybeSingle();
    if (!existing) {
      return createSkillResult({ success: false, errorCode: 'TOURNAMENT_NOT_FOUND', errorMessage: 'Torneo no encontrado' });
    }
    if (!(await isOrgAdmin(userId, existing.org_id, db))) {
      return createSkillResult({ success: false, errorCode: 'FORBIDDEN', errorMessage: 'Solo el administrador de la organización puede eliminar torneos' });
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

  async _registerTeam({ tournamentId, seriesId, groupName, seed }, db, userId) {
    if (!tournamentId || !seriesId) {
      return createSkillResult({ success: false, errorCode: 'MISSING_FIELDS', errorMessage: 'tournamentId y seriesId son requeridos' });
    }

    const { data: series } = await db
      .from('lg_club_series').select('id, club_id, category_id').eq('id', seriesId).maybeSingle();
    if (!series) {
      return createSkillResult({ success: false, errorCode: 'SERIES_NOT_FOUND', errorMessage: 'Serie no encontrada' });
    }

    const accessError = await assertClubAccess(series.club_id, userId, db);
    if (accessError) {
      return createSkillResult({ success: false, errorCode: accessError, errorMessage: 'No tienes permisos para inscribir series de este club' });
    }

    const { data: tournament } = await db
      .from('lg_tournaments').select('id, org_id, season_id, status, category_id').eq('id', tournamentId).maybeSingle();
    if (!tournament) {
      return createSkillResult({ success: false, errorCode: 'TOURNAMENT_NOT_FOUND', errorMessage: 'Torneo no encontrado' });
    }
    if (tournament.status !== 'REGISTRATION') {
      return createSkillResult({ success: false, errorCode: 'TOURNAMENT_NOT_OPEN', errorMessage: 'El torneo no está abierto a inscripciones' });
    }

    // El club dueño de la serie debe pertenecer a la MISMA organización que
    // el torneo — assertClubAccess solo valida que el usuario administre el
    // club (en su propia org), no que el club y el torneo compartan
    // organización. Sin este chequeo, un ADMIN_CLUB de la Org A podría
    // inscribir su serie en un torneo de la Org B.
    const { data: seriesClub } = await db.from('lg_clubs').select('org_id').eq('id', series.club_id).maybeSingle();
    if (!seriesClub || seriesClub.org_id !== tournament.org_id) {
      return createSkillResult({ success: false, errorCode: 'CLUB_ORG_MISMATCH', errorMessage: 'El club no pertenece a la organización dueña del torneo' });
    }

    // Si el torneo tiene categoría definida, la serie debe pertenecer a esa
    // misma categoría. Si el torneo no tiene categoría (NULL), se omite la
    // validación — un torneo sin categoría definida acepta series de cualquiera.
    if (tournament.category_id && series.category_id !== tournament.category_id) {
      return createSkillResult({ success: false, errorCode: 'CATEGORY_MISMATCH', errorMessage: 'La categoría de la serie no coincide con la categoría del torneo' });
    }

    // El club dueño de la serie debe estar ya inscrito al torneo (gate previo,
    // ver REGISTER_CLUB) antes de poder agregar cualquiera de sus series.
    const { data: clubRegistration } = await db
      .from('lg_tournament_clubs').select('id').eq('tournament_id', tournamentId).eq('club_id', series.club_id).maybeSingle();
    if (!clubRegistration) {
      return createSkillResult({ success: false, errorCode: 'CLUB_NOT_REGISTERED', errorMessage: 'El club debe inscribirse al torneo antes de agregar equipos' });
    }

    // Admin de club (no de organización): solo puede inscribir a torneos de la temporada activa.
    const callerIsOrgAdmin = await isOrgAdmin(userId, tournament.org_id, db);
    if (!callerIsOrgAdmin) {
      const { data: season } = tournament.season_id
        ? await db.from('lg_seasons').select('active').eq('id', tournament.season_id).maybeSingle()
        : { data: null };
      if (!season?.active) {
        return createSkillResult({ success: false, errorCode: 'SEASON_NOT_ACTIVE', errorMessage: 'Solo se puede inscribir a torneos de la temporada activa' });
      }
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

    // El cobro INSCRIPCION ya no se genera aquí: se dispara UNA vez por club
    // al inscribirse (REGISTER_CLUB), no por cada serie del club.

    return createSkillResult({ success: true, data: { team } });
  }

  async _unregisterTeam({ tournamentId, teamId }, db, userId) {
    const { data: existingTeam } = await db
      .from('lg_tournament_teams').select('series_id').eq('id', teamId).eq('tournament_id', tournamentId).maybeSingle();
    if (!existingTeam) {
      return createSkillResult({ success: false, errorCode: 'TEAM_NOT_FOUND', errorMessage: 'Inscripción no encontrada' });
    }

    const { data: series } = await db
      .from('lg_club_series').select('club_id').eq('id', existingTeam.series_id).maybeSingle();
    if (series) {
      const accessError = await assertClubAccess(series.club_id, userId, db);
      if (accessError) {
        return createSkillResult({ success: false, errorCode: accessError, errorMessage: 'No tienes permisos para retirar series de este club' });
      }
    }

    const { error } = await db
      .from('lg_tournament_teams').delete().eq('id', teamId).eq('tournament_id', tournamentId);
    if (error) {
      return createSkillResult({ success: false, errorCode: 'UNREGISTER_TEAM_FAILED', errorMessage: error.message });
    }
    return createSkillResult({ success: true, data: { deleted: true, teamId } });
  }

  // ── Clubes inscritos (gate previo a las series/equipos) ─────────────────────

  /**
   * Lista los clubes inscritos en un torneo, decorados con el estado de su
   * cobro INSCRIPCION (PENDIENTE/PARCIAL/PAGADO/VENCIDO — computeEntryStatus,
   * calculado en runtime desde lg_ledger_entries, sin columna de estado
   * propia en lg_tournament_clubs) para que el frontend arme el listado de
   * "clubes ya inscritos, disponibles para agregar equipo".
   */
  async _listTournamentClubs({ tournamentId }, db, userId) {
    if (!tournamentId) {
      return createSkillResult({ success: false, errorCode: 'MISSING_FIELDS', errorMessage: 'tournamentId es requerido' });
    }

    const { data: tournament } = await db.from('lg_tournaments').select('id, org_id').eq('id', tournamentId).maybeSingle();
    if (!tournament) {
      return createSkillResult({ success: false, errorCode: 'TOURNAMENT_NOT_FOUND', errorMessage: 'Torneo no encontrado' });
    }

    // Expone montos adeudados/pagados por club (inscription_charge) — datos
    // financieros. Un ADMIN de la organización ve todos los clubes inscritos;
    // cualquier otro usuario (ADMIN_CLUB u otro) solo ve los clubes a los
    // que tiene acceso (mismo patrón que club_finance_specialist.js con
    // assertClubAccess/getAccessibleClubIds).
    let accessibleClubIds = null; // null = sin restricción (admin de org)
    if (!(await isOrgAdmin(userId, tournament.org_id, db))) {
      const clubIds = await getAccessibleClubIds(userId, tournament.org_id, db);
      accessibleClubIds = clubIds === 'ALL' ? null : clubIds;
      if (Array.isArray(accessibleClubIds) && accessibleClubIds.length === 0) {
        return createSkillResult({ success: true, data: { clubs: [] } });
      }
    }

    let query = db
      .from('lg_tournament_clubs')
      .select('*, club:lg_clubs(id,name,short_name,logo_url)')
      .eq('tournament_id', tournamentId)
      .order('created_at', { ascending: true });
    if (Array.isArray(accessibleClubIds)) query = query.in('club_id', accessibleClubIds);

    const { data: clubs, error } = await query;
    if (error) {
      return createSkillResult({ success: false, errorCode: 'LIST_TOURNAMENT_CLUBS_FAILED', errorMessage: error.message });
    }

    const { data: ledgerEntries } = await db
      .from('lg_ledger_entries')
      .select('id, club_id, amount, paid_amount, due_date')
      .eq('tournament_id', tournamentId)
      .eq('category', 'INSCRIPCION')
      .is('series_id', null);
    const entryByClubId = new Map((ledgerEntries ?? []).map((e) => [e.club_id, e]));

    const decorated = (clubs ?? []).map((c) => {
      const entry = entryByClubId.get(c.club_id) ?? null;
      return {
        ...c,
        inscription_charge: entry,
        inscription_status: entry ? computeEntryStatus(entry) : 'SIN_COBRO',
      };
    });

    return createSkillResult({ success: true, data: { clubs: decorated } });
  }

  async _registerClub({ tournamentId, clubId }, db, userId) {
    if (!tournamentId || !clubId) {
      return createSkillResult({ success: false, errorCode: 'MISSING_FIELDS', errorMessage: 'tournamentId y clubId son requeridos' });
    }

    const accessError = await assertClubAccess(clubId, userId, db);
    if (accessError) {
      return createSkillResult({ success: false, errorCode: accessError, errorMessage: 'No tienes permisos para inscribir este club' });
    }

    const { data: tournament } = await db
      .from('lg_tournaments').select('id, org_id, season_id, status, inscription_fee').eq('id', tournamentId).maybeSingle();
    if (!tournament) {
      return createSkillResult({ success: false, errorCode: 'TOURNAMENT_NOT_FOUND', errorMessage: 'Torneo no encontrado' });
    }
    if (tournament.status !== 'REGISTRATION') {
      return createSkillResult({ success: false, errorCode: 'TOURNAMENT_NOT_OPEN', errorMessage: 'El torneo no está abierto a inscripciones' });
    }

    // El club debe pertenecer a la MISMA organización que el torneo —
    // assertClubAccess solo valida que el usuario administre el club (en su
    // propia org), no que el club y el torneo compartan organización. Sin
    // este chequeo, un ADMIN_CLUB de la Org A podría inscribir (y generar
    // un cobro INSCRIPCION) en un torneo de la Org B.
    const { data: club } = await db.from('lg_clubs').select('org_id').eq('id', clubId).maybeSingle();
    if (!club || club.org_id !== tournament.org_id) {
      return createSkillResult({ success: false, errorCode: 'CLUB_ORG_MISMATCH', errorMessage: 'El club no pertenece a la organización dueña del torneo' });
    }

    // Admin de club (no de organización): solo puede inscribir a torneos de la temporada activa.
    const callerIsOrgAdmin = await isOrgAdmin(userId, tournament.org_id, db);
    if (!callerIsOrgAdmin) {
      const { data: season } = tournament.season_id
        ? await db.from('lg_seasons').select('active').eq('id', tournament.season_id).maybeSingle()
        : { data: null };
      if (!season?.active) {
        return createSkillResult({ success: false, errorCode: 'SEASON_NOT_ACTIVE', errorMessage: 'Solo se puede inscribir a torneos de la temporada activa' });
      }
    }

    const { data: tournamentClub, error } = await db
      .from('lg_tournament_clubs')
      .insert({ tournament_id: tournamentId, club_id: clubId, registered_by: userId ?? null })
      .select('*, club:lg_clubs(id,name,short_name,logo_url)')
      .single();

    if (error) {
      if (error.code === '23505') {
        return createSkillResult({ success: false, errorCode: 'DUPLICATE_CLUB_REGISTRATION', errorMessage: 'Este club ya está inscrito en este torneo' });
      }
      return createSkillResult({ success: false, errorCode: 'REGISTER_CLUB_FAILED', errorMessage: error.message });
    }

    // Cobro INSCRIPCION, una sola vez por club (no por serie) — usa el costo
    // propio del torneo (lg_tournaments.inscription_fee), no el catálogo por
    // temporada. seriesId va null: este cobro es a nivel de club, no de serie.
    const chargeResult = await createInscriptionCharge({
      orgId: tournament.org_id,
      clubId,
      seriesId: null,
      tournamentId,
      seasonId: tournament.season_id,
      amount: tournament.inscription_fee,
    }, db);
    if (chargeResult.error) {
      // La inscripción ya quedó registrada — un problema del libro no debe revertirla.
      console.error('[tournaments] createInscriptionCharge failed:', chargeResult.error.message);
    }

    return createSkillResult({ success: true, data: { tournamentClub } });
  }

  async _unregisterClub({ tournamentId, clubId }, db, userId) {
    if (!tournamentId || !clubId) {
      return createSkillResult({ success: false, errorCode: 'MISSING_FIELDS', errorMessage: 'tournamentId y clubId son requeridos' });
    }

    const accessError = await assertClubAccess(clubId, userId, db);
    if (accessError) {
      return createSkillResult({ success: false, errorCode: accessError, errorMessage: 'No tienes permisos para retirar este club' });
    }

    const { data: existing } = await db
      .from('lg_tournament_clubs').select('id').eq('tournament_id', tournamentId).eq('club_id', clubId).maybeSingle();
    if (!existing) {
      return createSkillResult({ success: false, errorCode: 'CLUB_NOT_REGISTERED', errorMessage: 'Este club no está inscrito en este torneo' });
    }

    // Decisión de diseño: no se permite retirar un club del torneo si ya
    // tiene series/equipos inscritos (lg_tournament_teams) — primero hay que
    // retirar (UNREGISTER_TEAM) cada serie de ese club, igual que un club no
    // puede eliminarse mientras tenga series activas en otros dominios.
    // Evita dejar equipos "huérfanos" (con fixture/resultados ya generados)
    // sin su club inscrito.
    const { data: clubSeries } = await db.from('lg_club_series').select('id').eq('club_id', clubId);
    const seriesIds = (clubSeries ?? []).map((s) => s.id);
    if (seriesIds.length > 0) {
      const { count: teamsCount } = await db
        .from('lg_tournament_teams')
        .select('id', { count: 'exact', head: true })
        .eq('tournament_id', tournamentId)
        .in('series_id', seriesIds);
      if (teamsCount > 0) {
        return createSkillResult({
          success: false,
          errorCode: 'CLUB_HAS_REGISTERED_TEAMS',
          errorMessage: 'El club tiene series/equipos inscritos en este torneo. Retire primero las series antes de retirar el club.',
        });
      }
    }

    const { error } = await db
      .from('lg_tournament_clubs').delete().eq('tournament_id', tournamentId).eq('club_id', clubId);
    if (error) {
      return createSkillResult({ success: false, errorCode: 'UNREGISTER_CLUB_FAILED', errorMessage: error.message });
    }
    return createSkillResult({ success: true, data: { deleted: true, tournamentId, clubId } });
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

    let oldMatchdayIds = [];
    if (existingMatches > 0 && force) {
      const { data: oldMatchdays } = await db.from('lg_matchdays').select('id').eq('tournament_id', tournamentId);
      oldMatchdayIds = (oldMatchdays ?? []).map((m) => m.id);
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

    if (oldMatchdayIds.length > 0) await clearUnpaidMatchdayCharges(oldMatchdayIds, db);
    await this._generateMatchdayCharges(tournamentId, tournament.org_id, tournament.season_id, db);

    return createSkillResult({ success: true, data: { stages: result.stages, matchesCreated: result.matchesCreated } });
  }

  /**
   * Genera el cobro FECHA (lib/ledger.js) para cada matchday del torneo que
   * todavía no tenga cobro asociado — cubre GENERATE_FIXTURE (primera vez y
   * regeneración con force), GENERATE_KNOCKOUT_FROM_GROUPS y GENERATE_CONSOLATION
   * por igual, sin duplicar cobros de matchdays ya cobrados.
   */
  async _generateMatchdayCharges(tournamentId, orgId, seasonId, db, onlySeriesIds = null) {
    try {
      const { data: chargedRows } = await db
        .from('lg_ledger_entries')
        .select('matchday_id')
        .eq('tournament_id', tournamentId)
        .eq('category', 'FECHA')
        .not('matchday_id', 'is', null);
      const chargedIds = new Set((chargedRows ?? []).map((r) => r.matchday_id));

      const { data: matchdays } = await db
        .from('lg_matchdays').select('id, date').eq('tournament_id', tournamentId);

      const pending = (matchdays ?? []).filter((m) => !chargedIds.has(m.id));
      for (const md of pending) {
        const result = await createMatchdayCharges(
          { orgId, tournamentId, seasonId, matchdayId: md.id, matchdayDate: md.date, onlySeriesIds }, db
        );
        if (result.error) console.error('[tournaments] createMatchdayCharges failed:', result.error.message);
      }
    } catch (err) {
      console.error('[tournaments] _generateMatchdayCharges failed:', err.message);
    }
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

    await this._generateMatchdayCharges(tournamentId, tournament.org_id, tournament.season_id, db);

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

    await this._generateMatchdayCharges(tournamentId, tournament.org_id, tournament.season_id, db, seriesIds);

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

    const { data: playedStandings, error } = await query;
    if (error) {
      return createSkillResult({ success: false, errorCode: 'STANDINGS_FAILED', errorMessage: error.message });
    }

    const standings = await this._fillZeroStandings(tournamentId, stageId, groupName, playedStandings || [], db);

    standings.sort((a, b) =>
      (a.stage_id || '').localeCompare(b.stage_id || '')
      || (a.group_name || '').localeCompare(b.group_name || '')
      || b.points - a.points
      || b.goal_diff - a.goal_diff
      || b.goals_for - a.goals_for
    );

    let position = 0;
    let lastKey = null;
    for (const row of standings) {
      const key = `${row.stage_id}-${row.group_name || '_'}`;
      position = key === lastKey ? position + 1 : 1;
      lastKey = key;
      row.position = position;
    }

    return createSkillResult({ success: true, data: { standings } });
  }

  /**
   * Completa la tabla de posiciones con los equipos inscritos que todavía
   * no tienen partidos finalizados (0 jugados, 0 puntos), para que la
   * tabla muestre desde la fecha 1 a todos los inscritos, no solo a los
   * que ya sumaron. Solo aplica a fases tipo GROUP (round robin/grupos) —
   * una fase KNOCKOUT no tiene "tabla de posiciones" en ese sentido.
   */
  async _fillZeroStandings(tournamentId, stageId, groupName, playedStandings, db) {
    let stagesQuery = db
      .from('lg_tournament_stages')
      .select('id')
      .eq('tournament_id', tournamentId)
      .eq('stage_type', 'GROUP');
    if (stageId) stagesQuery = stagesQuery.eq('id', stageId);

    const { data: groupStages, error: stagesErr } = await stagesQuery;
    if (stagesErr) {
      console.error('_fillZeroStandings: error consultando lg_tournament_stages:', stagesErr.message);
      return playedStandings;
    }
    if (!groupStages || groupStages.length === 0) return playedStandings;

    const { data: teams, error: teamsErr } = await db
      .from('lg_tournament_teams')
      .select('series_id, group_name, series:lg_club_series(id,name,club:lg_clubs(id,name))')
      .eq('tournament_id', tournamentId);
    if (teamsErr) {
      console.error('_fillZeroStandings: error consultando lg_tournament_teams:', teamsErr.message);
      return playedStandings;
    }
    if (!teams || teams.length === 0) return playedStandings;

    const present = new Set(playedStandings.map((s) => `${s.stage_id}-${s.series_id}`));
    const zeroRows = [];

    for (const stage of groupStages) {
      for (const team of teams) {
        if (groupName && team.group_name !== groupName) continue;
        if (present.has(`${stage.id}-${team.series_id}`)) continue;

        zeroRows.push({
          tournament_id: tournamentId,
          stage_id: stage.id,
          group_name: team.group_name || null,
          series_id: team.series_id,
          series_name: team.series?.name || null,
          club_id: team.series?.club?.id || null,
          club_name: team.series?.club?.name || null,
          played: 0, won: 0, drawn: 0, lost: 0,
          goals_for: 0, goals_against: 0, goal_diff: 0, points: 0,
          position: null,
        });
      }
    }

    return [...playedStandings, ...zeroRows];
  }
}
