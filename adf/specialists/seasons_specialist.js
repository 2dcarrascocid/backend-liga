/**
 * ADF - Seasons Specialist (Specialists Layer)
 *
 * Ejecuta operaciones del dominio de temporadas (ej: "Temporada 2026"),
 * el nivel por encima de Torneo — un torneo (amistoso u oficial) pertenece
 * a una temporada vía lg_tournaments.season_id.
 *
 * DO:
 *   - Operar sobre lg_seasons
 *   - Filtrar siempre por org_id (las temporadas son a nivel de organización)
 *   - Ordenar listados por year DESC (la más reciente primero)
 *
 * DON'T:
 *   - No gestionar torneos — eso es dominio de TournamentsSpecialist
 *   - No lanzar excepciones no controladas
 *
 * Capabilities:
 *   LIST_SEASONS | CREATE_SEASON | UPDATE_SEASON | DELETE_SEASON
 */

import { Skill } from '../contracts/skill_contract.js';
import { createSkillResult } from '../contracts/task_schema.js';

const CAPABILITIES = [
  'LIST_SEASONS',
  'CREATE_SEASON',
  'UPDATE_SEASON',
  'DELETE_SEASON',
];

export class SeasonsSpecialist extends Skill {
  constructor() {
    super('seasons_specialist', '1.0.0');
    this.domain = 'seasons';
    this.capabilities = CAPABILITIES;

    this.contract = {
      input: [
        { name: 'operation', required: true,  type: 'string' },
        { name: 'payload',   required: true,  type: 'object' },
        { name: 'db',        required: true,  type: 'object' },
      ],
      output: [
        { name: 'season',  type: 'object' },
        { name: 'seasons', type: 'array'  },
      ],
      rules: {
        do: [
          'Filtrar siempre por org_id en LIST y DELETE',
          'Ordenar por year DESC en LIST_SEASONS',
        ],
        dont: [
          'No gestionar torneos desde este specialist',
        ],
      },
      checklist: [
        'LIST_SEASONS ordena por year DESC',
        'CREATE_SEASON valida org_id, name y year',
        'DELETE verifica que la temporada pertenece a la org',
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
        case 'LIST_SEASONS':  return this._listSeasons(payload, db);
        case 'CREATE_SEASON': return this._createSeason(payload, db);
        case 'UPDATE_SEASON': return this._updateSeason(payload, db);
        case 'DELETE_SEASON': return this._deleteSeason(payload, db);
      }
    } catch (err) {
      return createSkillResult({
        success: false,
        errorCode: 'SEASONS_SPECIALIST_ERROR',
        errorMessage: err.message,
      });
    }
  }

  async _listSeasons({ orgId, active }, db) {
    if (!orgId) {
      return createSkillResult({ success: false, errorCode: 'MISSING_ORG', errorMessage: 'org_id es requerido' });
    }

    let query = db.from('lg_seasons').select('*').eq('org_id', orgId);
    if (active !== undefined) query = query.eq('active', active === true || active === 'true');
    query = query.order('year', { ascending: false }).order('name', { ascending: true });

    const { data: seasons, error } = await query;
    if (error) {
      return createSkillResult({ success: false, errorCode: 'LIST_SEASONS_FAILED', errorMessage: error.message });
    }

    return createSkillResult({ success: true, data: { seasons } });
  }

  async _createSeason({ orgId, name, year, active }, db) {
    if (!orgId || !name || !year) {
      return createSkillResult({ success: false, errorCode: 'MISSING_FIELDS', errorMessage: 'org_id, name y year son requeridos' });
    }

    const { data: season, error } = await db
      .from('lg_seasons')
      .insert({
        org_id: orgId,
        name,
        year: parseInt(year, 10),
        active: active ?? true,
      })
      .select()
      .single();

    if (error) {
      const isDuplicate = error.code === '23505';
      return createSkillResult({
        success: false,
        errorCode: isDuplicate ? 'DUPLICATE_SEASON' : 'CREATE_SEASON_FAILED',
        errorMessage: isDuplicate ? `Ya existe una temporada con el nombre "${name}" en esta organización` : error.message,
      });
    }

    return createSkillResult({ success: true, data: { season } });
  }

  async _updateSeason({ seasonId, name, year, active }, db) {
    const patch = Object.fromEntries(
      Object.entries({ name, year: year !== undefined ? parseInt(year, 10) : undefined, active })
        .filter(([, v]) => v !== undefined)
    );

    if (Object.keys(patch).length === 0) {
      return createSkillResult({ success: false, errorCode: 'NO_FIELDS', errorMessage: 'No hay campos válidos para actualizar' });
    }
    patch.updated_at = new Date().toISOString();

    const { data: season, error } = await db
      .from('lg_seasons')
      .update(patch)
      .eq('id', seasonId)
      .select()
      .single();

    if (error) {
      return createSkillResult({ success: false, errorCode: 'UPDATE_SEASON_FAILED', errorMessage: error.message });
    }

    return createSkillResult({ success: true, data: { season } });
  }

  async _deleteSeason({ seasonId, orgId }, db) {
    const { data: existing } = await db
      .from('lg_seasons')
      .select('id')
      .eq('id', seasonId)
      .eq('org_id', orgId)
      .maybeSingle();

    if (!existing) {
      return createSkillResult({ success: false, errorCode: 'SEASON_NOT_FOUND', errorMessage: 'Temporada no encontrada en esta organización' });
    }

    const { error } = await db.from('lg_seasons').delete().eq('id', seasonId);
    if (error) {
      return createSkillResult({ success: false, errorCode: 'DELETE_SEASON_FAILED', errorMessage: error.message });
    }

    return createSkillResult({ success: true, data: { deleted: true, seasonId } });
  }
}
