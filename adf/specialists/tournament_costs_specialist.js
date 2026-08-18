/**
 * ADF - Tournament Costs Specialist (Specialists Layer)
 *
 * Módulo de costos y finanzas del torneo: costos generales por
 * Fecha/Jornada (arriendo, logística) y costos específicos por
 * Partido (arbitraje, uso de cancha).
 *
 * DO:
 *   - Mantener costos de jornada y de partido en tablas separadas
 *   - Calcular el resumen de costos agregando en memoria (sin vista extra)
 *
 * DON'T:
 *   - No crear ni administrar torneos/fixture/partidos — eso es de otros dominios
 *
 * Capabilities:
 *   LIST_MATCHDAY_COSTS | CREATE_MATCHDAY_COST | DELETE_MATCHDAY_COST
 *   LIST_MATCH_COSTS | CREATE_MATCH_COST | DELETE_MATCH_COST
 *   GET_COSTS_SUMMARY
 */

import { Skill } from '../contracts/skill_contract.js';
import { createSkillResult } from '../contracts/task_schema.js';

const CAPABILITIES = [
  'LIST_MATCHDAY_COSTS', 'CREATE_MATCHDAY_COST', 'DELETE_MATCHDAY_COST',
  'LIST_MATCH_COSTS', 'CREATE_MATCH_COST', 'DELETE_MATCH_COST',
  'GET_COSTS_SUMMARY',
];

export class TournamentCostsSpecialist extends Skill {
  constructor() {
    super('tournament_costs_specialist', '1.0.0');
    this.domain = 'tournament_costs';
    this.capabilities = CAPABILITIES;

    this.contract = {
      input: [
        { name: 'operation', required: true, type: 'string' },
        { name: 'payload', required: true, type: 'object' },
        { name: 'db', required: true, type: 'object' },
      ],
      output: [
        { name: 'cost', type: 'object' },
        { name: 'costs', type: 'array' },
        { name: 'summary', type: 'object' },
      ],
      rules: {
        do: ['Mantener separados los costos de jornada y de partido'],
        dont: ['No gestionar torneos, fixture ni partidos'],
      },
      checklist: [
        'CREATE_MATCHDAY_COST y CREATE_MATCH_COST validan concept/amount',
        'GET_COSTS_SUMMARY desglosa por jornada y por partido',
      ],
    };
  }

  async execute(task) {
    const { operation, payload, db } = task.input;

    if (!this.capabilities.includes(operation)) {
      return createSkillResult({ success: false, errorCode: 'UNKNOWN_OPERATION', errorMessage: `Operación desconocida: "${operation}"` });
    }

    try {
      switch (operation) {
        case 'LIST_MATCHDAY_COSTS': return this._listMatchdayCosts(payload, db);
        case 'CREATE_MATCHDAY_COST': return this._createMatchdayCost(payload, db);
        case 'DELETE_MATCHDAY_COST': return this._deleteMatchdayCost(payload, db);
        case 'LIST_MATCH_COSTS': return this._listMatchCosts(payload, db);
        case 'CREATE_MATCH_COST': return this._createMatchCost(payload, db);
        case 'DELETE_MATCH_COST': return this._deleteMatchCost(payload, db);
        case 'GET_COSTS_SUMMARY': return this._getCostsSummary(payload, db);
      }
    } catch (err) {
      return createSkillResult({ success: false, errorCode: 'TOURNAMENT_COSTS_SPECIALIST_ERROR', errorMessage: err.message });
    }
  }

  _validateCost({ concept, amount }) {
    if (!concept || amount === undefined || amount === null || isNaN(Number(amount))) {
      return 'concept y amount (numérico) son requeridos';
    }
    return null;
  }

  // ── Costos por Fecha/Jornada ─────────────────────────────────────────────

  async _listMatchdayCosts({ matchdayId }, db) {
    const { data: costs, error } = await db
      .from('lg_matchday_costs').select('*').eq('matchday_id', matchdayId).order('created_at', { ascending: false });
    if (error) return createSkillResult({ success: false, errorCode: 'LIST_MATCHDAY_COSTS_FAILED', errorMessage: error.message });
    return createSkillResult({ success: true, data: { costs } });
  }

  async _createMatchdayCost({ matchdayId, concept, amount, notes }, db) {
    const validationError = this._validateCost({ concept, amount });
    if (!matchdayId || validationError) {
      return createSkillResult({ success: false, errorCode: 'MISSING_FIELDS', errorMessage: validationError || 'matchdayId es requerido' });
    }
    const { data: cost, error } = await db
      .from('lg_matchday_costs').insert({ matchday_id: matchdayId, concept, amount, notes: notes ?? null }).select().single();
    if (error) return createSkillResult({ success: false, errorCode: 'CREATE_MATCHDAY_COST_FAILED', errorMessage: error.message });
    return createSkillResult({ success: true, data: { cost } });
  }

  async _deleteMatchdayCost({ costId }, db) {
    const { error } = await db.from('lg_matchday_costs').delete().eq('id', costId);
    if (error) return createSkillResult({ success: false, errorCode: 'DELETE_MATCHDAY_COST_FAILED', errorMessage: error.message });
    return createSkillResult({ success: true, data: { deleted: true, costId } });
  }

  // ── Costos por Partido ───────────────────────────────────────────────────

  async _listMatchCosts({ matchId }, db) {
    const { data: costs, error } = await db
      .from('lg_match_costs').select('*').eq('match_id', matchId).order('created_at', { ascending: false });
    if (error) return createSkillResult({ success: false, errorCode: 'LIST_MATCH_COSTS_FAILED', errorMessage: error.message });
    return createSkillResult({ success: true, data: { costs } });
  }

  async _createMatchCost({ matchId, concept, amount, notes }, db) {
    const validationError = this._validateCost({ concept, amount });
    if (!matchId || validationError) {
      return createSkillResult({ success: false, errorCode: 'MISSING_FIELDS', errorMessage: validationError || 'matchId es requerido' });
    }
    const { data: cost, error } = await db
      .from('lg_match_costs').insert({ match_id: matchId, concept, amount, notes: notes ?? null }).select().single();
    if (error) return createSkillResult({ success: false, errorCode: 'CREATE_MATCH_COST_FAILED', errorMessage: error.message });
    return createSkillResult({ success: true, data: { cost } });
  }

  async _deleteMatchCost({ costId }, db) {
    const { error } = await db.from('lg_match_costs').delete().eq('id', costId);
    if (error) return createSkillResult({ success: false, errorCode: 'DELETE_MATCH_COST_FAILED', errorMessage: error.message });
    return createSkillResult({ success: true, data: { deleted: true, costId } });
  }

  // ── Resumen ──────────────────────────────────────────────────────────────

  async _getCostsSummary({ tournamentId }, db) {
    if (!tournamentId) {
      return createSkillResult({ success: false, errorCode: 'MISSING_FIELDS', errorMessage: 'tournamentId es requerido' });
    }

    const { data: matchdays } = await db.from('lg_matchdays').select('id,number,name').eq('tournament_id', tournamentId);
    const matchdayIds = (matchdays || []).map((m) => m.id);

    const { data: matches } = await db.from('lg_matches').select('id,round_number').eq('tournament_id', tournamentId);
    const matchIds = (matches || []).map((m) => m.id);

    let matchdayCosts = [];
    if (matchdayIds.length > 0) {
      const { data } = await db.from('lg_matchday_costs').select('*').in('matchday_id', matchdayIds);
      matchdayCosts = data || [];
    }

    let matchCosts = [];
    if (matchIds.length > 0) {
      const { data } = await db.from('lg_match_costs').select('*').in('match_id', matchIds);
      matchCosts = data || [];
    }

    const totalMatchdayCosts = matchdayCosts.reduce((sum, c) => sum + Number(c.amount), 0);
    const totalMatchCosts = matchCosts.reduce((sum, c) => sum + Number(c.amount), 0);

    const matchdayById = Object.fromEntries((matchdays || []).map((m) => [m.id, m]));
    const byMatchday = matchdayIds
      .map((id) => ({
        matchday: matchdayById[id],
        total: matchdayCosts.filter((c) => c.matchday_id === id).reduce((sum, c) => sum + Number(c.amount), 0),
      }))
      .filter((row) => row.total > 0);

    return createSkillResult({
      success: true,
      data: {
        summary: {
          totalMatchdayCosts,
          totalMatchCosts,
          grandTotal: totalMatchdayCosts + totalMatchCosts,
          matchdayCostsCount: matchdayCosts.length,
          matchCostsCount: matchCosts.length,
        },
        byMatchday,
        matchdayCosts,
        matchCosts,
      },
    });
  }
}
