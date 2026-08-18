/**
 * ADF - Referees Specialist (Specialists Layer)
 *
 * Ejecuta operaciones del dominio de árbitros.
 * Maneja: listado, detalle, creación, actualización y eliminación
 * de árbitros por organización.
 *
 * DO:
 *   - Operar sobre lg_referees
 *   - Filtrar siempre por org_id en LIST y DELETE
 *   - Usar paginación en LIST_REFEREES
 *
 * DON'T:
 *   - No gestionar asignación de árbitros a partidos — eso es de otro dominio
 *   - No lanzar excepciones no controladas
 *
 * Capabilities:
 *   LIST_REFEREES | GET_REFEREE | CREATE_REFEREE | UPDATE_REFEREE | DELETE_REFEREE
 *
 * Checklist:
 *   [ ] ¿LIST_REFEREES filtra por org_id y pagina?
 *   [ ] ¿CREATE_REFEREE valida full_name/orgId?
 *   [ ] ¿UPDATE_REFEREE solo modifica campos permitidos?
 *   [ ] ¿DELETE_REFEREE verifica que el árbitro existe?
 */

import { Skill } from '../contracts/skill_contract.js';
import { createSkillResult } from '../contracts/task_schema.js';

const CAPABILITIES = [
  'LIST_REFEREES',
  'GET_REFEREE',
  'CREATE_REFEREE',
  'UPDATE_REFEREE',
  'DELETE_REFEREE',
];

const UPDATABLE_FIELDS = {
  fullName: 'full_name',
  phone: 'phone',
  email: 'email',
  notes: 'notes',
  active: 'active',
};

export class RefereesSpecialist extends Skill {
  constructor() {
    super('referees_specialist', '1.0.0');
    this.domain = 'referees';
    this.capabilities = CAPABILITIES;

    this.contract = {
      input: [
        { name: 'operation', required: true,  type: 'string' },
        { name: 'payload',   required: true,  type: 'object' },
        { name: 'db',        required: true,  type: 'object' },
        { name: 'userId',    required: false, type: 'string' },
      ],
      output: [
        { name: 'referee',   type: 'object' },
        { name: 'referees',  type: 'array'  },
        { name: 'nextToken', type: 'string' },
      ],
      rules: {
        do: [
          'Filtrar siempre por org_id en LIST_REFEREES y DELETE_REFEREE',
          'Ordenar LIST_REFEREES por full_name ASC',
          'Aplicar paginación en LIST_REFEREES',
        ],
        dont: [
          'No gestionar designaciones de árbitros a partidos desde este specialist',
        ],
      },
      checklist: [
        'LIST_REFEREES filtra por org_id y pagina',
        'CREATE_REFEREE incluye org_id y full_name',
        'DELETE_REFEREE verifica existencia antes de eliminar',
        'UPDATE_REFEREE solo modifica campos permitidos',
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
        case 'LIST_REFEREES':  return this._listReferees(payload, db);
        case 'GET_REFEREE':    return this._getReferee(payload, db);
        case 'CREATE_REFEREE': return this._createReferee(payload, db);
        case 'UPDATE_REFEREE': return this._updateReferee(payload, db);
        case 'DELETE_REFEREE': return this._deleteReferee(payload, db);
      }
    } catch (err) {
      return createSkillResult({
        success: false,
        errorCode: 'REFEREES_SPECIALIST_ERROR',
        errorMessage: err.message,
      });
    }
  }

  async _listReferees({ orgId, limit = 20, nextToken, active, q }, db) {
    if (!orgId) {
      return createSkillResult({
        success: false,
        errorCode: 'MISSING_ORG',
        errorMessage: 'org_id es requerido',
      });
    }

    let query = db
      .from('lg_referees')
      .select('*')
      .eq('org_id', orgId)
      .order('full_name', { ascending: true });

    if (active !== undefined && active !== null && active !== '') {
      const activeBool = active === true || active === 'true';
      query = query.eq('active', activeBool);
    }
    if (q) query = query.or(`full_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`);

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

    const { data: referees, error } = await query;

    if (error) {
      return createSkillResult({
        success: false,
        errorCode: 'LIST_REFEREES_FAILED',
        errorMessage: error.message,
      });
    }

    const hasMore = referees.length === limit;
    const next = hasMore ? Buffer.from(String(limit)).toString('base64') : null;

    return createSkillResult({ success: true, data: { referees, nextToken: next } });
  }

  async _getReferee({ refereeId }, db) {
    const { data: referee, error } = await db
      .from('lg_referees')
      .select('*')
      .eq('id', refereeId)
      .maybeSingle();

    if (error || !referee) {
      return createSkillResult({
        success: false,
        errorCode: 'REFEREE_NOT_FOUND',
        errorMessage: 'Árbitro no encontrado',
      });
    }

    return createSkillResult({ success: true, data: { referee } });
  }

  async _createReferee({ orgId, fullName, phone, email, notes, active }, db) {
    if (!orgId || !fullName) {
      return createSkillResult({
        success: false,
        errorCode: 'MISSING_FIELDS',
        errorMessage: 'org_id y full_name son requeridos',
      });
    }

    const { data: referee, error } = await db
      .from('lg_referees')
      .insert({
        org_id:    orgId,
        full_name: fullName,
        phone:     phone ?? null,
        email:     email ?? null,
        notes:     notes ?? null,
        active:    active ?? true,
      })
      .select()
      .single();

    if (error) {
      return createSkillResult({
        success: false,
        errorCode: 'CREATE_REFEREE_FAILED',
        errorMessage: error.message,
      });
    }

    return createSkillResult({ success: true, data: { referee } });
  }

  async _updateReferee({ refereeId, ...updates }, db) {
    const patch = {};
    for (const [key, column] of Object.entries(UPDATABLE_FIELDS)) {
      if (updates[key] !== undefined) patch[column] = updates[key];
      else if (updates[column] !== undefined) patch[column] = updates[column];
    }

    if (Object.keys(patch).length === 0) {
      return createSkillResult({
        success: false,
        errorCode: 'NO_FIELDS',
        errorMessage: 'No hay campos válidos para actualizar',
      });
    }

    patch.updated_at = new Date().toISOString();

    const { data: referee, error } = await db
      .from('lg_referees')
      .update(patch)
      .eq('id', refereeId)
      .select()
      .single();

    if (error) {
      return createSkillResult({
        success: false,
        errorCode: 'UPDATE_REFEREE_FAILED',
        errorMessage: error.message,
      });
    }

    return createSkillResult({ success: true, data: { referee } });
  }

  async _deleteReferee({ refereeId }, db) {
    const { data: existing, error: fetchErr } = await db
      .from('lg_referees')
      .select('id')
      .eq('id', refereeId)
      .maybeSingle();

    if (fetchErr || !existing) {
      return createSkillResult({
        success: false,
        errorCode: 'REFEREE_NOT_FOUND',
        errorMessage: 'Árbitro no encontrado',
      });
    }

    const { error } = await db
      .from('lg_referees')
      .delete()
      .eq('id', refereeId);

    if (error) {
      return createSkillResult({
        success: false,
        errorCode: 'DELETE_REFEREE_FAILED',
        errorMessage: error.message,
      });
    }

    return createSkillResult({ success: true, data: { deleted: true, refereeId } });
  }
}
