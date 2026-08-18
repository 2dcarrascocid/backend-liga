/**
 * ADF - Venues Specialist (Specialists Layer)
 *
 * Ejecuta operaciones del dominio de canchas (venues).
 * Maneja: listado, detalle, creación, actualización y eliminación
 * de canchas por organización.
 *
 * DO:
 *   - Operar sobre lg_venues
 *   - Filtrar siempre por org_id en LIST y DELETE
 *   - Usar paginación en LIST_VENUES
 *
 * DON'T:
 *   - No gestionar la programación de partidos en canchas — eso es de otro dominio
 *   - No lanzar excepciones no controladas
 *
 * Capabilities:
 *   LIST_VENUES | GET_VENUE | CREATE_VENUE | UPDATE_VENUE | DELETE_VENUE
 *
 * Checklist:
 *   [ ] ¿LIST_VENUES filtra por org_id y pagina?
 *   [ ] ¿CREATE_VENUE valida name/orgId?
 *   [ ] ¿UPDATE_VENUE solo modifica campos permitidos?
 *   [ ] ¿DELETE_VENUE verifica que la cancha existe?
 */

import { Skill } from '../contracts/skill_contract.js';
import { createSkillResult } from '../contracts/task_schema.js';

const CAPABILITIES = [
  'LIST_VENUES',
  'GET_VENUE',
  'CREATE_VENUE',
  'UPDATE_VENUE',
  'DELETE_VENUE',
];

const UPDATABLE_FIELDS = {
  name: 'name',
  address: 'address',
  region: 'region',
  city: 'city',
  surfaceType: 'surface_type',
  lighting: 'lighting',
  status: 'status',
  notes: 'notes',
};

export class VenuesSpecialist extends Skill {
  constructor() {
    super('venues_specialist', '1.0.0');
    this.domain = 'venues';
    this.capabilities = CAPABILITIES;

    this.contract = {
      input: [
        { name: 'operation', required: true,  type: 'string' },
        { name: 'payload',   required: true,  type: 'object' },
        { name: 'db',        required: true,  type: 'object' },
        { name: 'userId',    required: false, type: 'string' },
      ],
      output: [
        { name: 'venue',     type: 'object' },
        { name: 'venues',    type: 'array'  },
        { name: 'nextToken', type: 'string' },
      ],
      rules: {
        do: [
          'Filtrar siempre por org_id en LIST_VENUES y DELETE_VENUE',
          'Ordenar LIST_VENUES por name ASC',
          'Aplicar paginación en LIST_VENUES',
        ],
        dont: [
          'No gestionar la programación de partidos en canchas desde este specialist',
        ],
      },
      checklist: [
        'LIST_VENUES filtra por org_id y pagina',
        'CREATE_VENUE incluye org_id y name',
        'DELETE_VENUE verifica existencia antes de eliminar',
        'UPDATE_VENUE solo modifica campos permitidos',
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
        case 'LIST_VENUES':  return this._listVenues(payload, db);
        case 'GET_VENUE':    return this._getVenue(payload, db);
        case 'CREATE_VENUE': return this._createVenue(payload, db);
        case 'UPDATE_VENUE': return this._updateVenue(payload, db);
        case 'DELETE_VENUE': return this._deleteVenue(payload, db);
      }
    } catch (err) {
      return createSkillResult({
        success: false,
        errorCode: 'VENUES_SPECIALIST_ERROR',
        errorMessage: err.message,
      });
    }
  }

  async _listVenues({ orgId, limit = 20, nextToken, status, q }, db) {
    if (!orgId) {
      return createSkillResult({
        success: false,
        errorCode: 'MISSING_ORG',
        errorMessage: 'org_id es requerido',
      });
    }

    let query = db
      .from('lg_venues')
      .select('*')
      .eq('org_id', orgId)
      .order('name', { ascending: true });

    if (status) query = query.eq('status', status);
    if (q) query = query.or(`name.ilike.%${q}%,address.ilike.%${q}%,city.ilike.%${q}%`);

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

    const { data: venues, error } = await query;

    if (error) {
      return createSkillResult({
        success: false,
        errorCode: 'LIST_VENUES_FAILED',
        errorMessage: error.message,
      });
    }

    const hasMore = venues.length === limit;
    const next = hasMore ? Buffer.from(String(limit)).toString('base64') : null;

    return createSkillResult({ success: true, data: { venues, nextToken: next } });
  }

  async _getVenue({ venueId }, db) {
    const { data: venue, error } = await db
      .from('lg_venues')
      .select('*')
      .eq('id', venueId)
      .maybeSingle();

    if (error || !venue) {
      return createSkillResult({
        success: false,
        errorCode: 'VENUE_NOT_FOUND',
        errorMessage: 'Cancha no encontrada',
      });
    }

    return createSkillResult({ success: true, data: { venue } });
  }

  async _createVenue({ orgId, name, address, region, city, surfaceType, lighting, status, notes }, db) {
    if (!orgId || !name) {
      return createSkillResult({
        success: false,
        errorCode: 'MISSING_FIELDS',
        errorMessage: 'org_id y name son requeridos',
      });
    }

    const { data: venue, error } = await db
      .from('lg_venues')
      .insert({
        org_id:       orgId,
        name,
        address:      address ?? null,
        region:       region ?? null,
        city:         city ?? null,
        surface_type: surfaceType ?? 'NATURAL',
        lighting:     lighting ?? false,
        status:       status ?? 'DISPONIBLE',
        notes:        notes ?? null,
      })
      .select()
      .single();

    if (error) {
      return createSkillResult({
        success: false,
        errorCode: 'CREATE_VENUE_FAILED',
        errorMessage: error.message,
      });
    }

    return createSkillResult({ success: true, data: { venue } });
  }

  async _updateVenue({ venueId, ...updates }, db) {
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

    const { data: venue, error } = await db
      .from('lg_venues')
      .update(patch)
      .eq('id', venueId)
      .select()
      .single();

    if (error) {
      return createSkillResult({
        success: false,
        errorCode: 'UPDATE_VENUE_FAILED',
        errorMessage: error.message,
      });
    }

    return createSkillResult({ success: true, data: { venue } });
  }

  async _deleteVenue({ venueId }, db) {
    const { data: existing, error: fetchErr } = await db
      .from('lg_venues')
      .select('id')
      .eq('id', venueId)
      .maybeSingle();

    if (fetchErr || !existing) {
      return createSkillResult({
        success: false,
        errorCode: 'VENUE_NOT_FOUND',
        errorMessage: 'Cancha no encontrada',
      });
    }

    const { error } = await db
      .from('lg_venues')
      .delete()
      .eq('id', venueId);

    if (error) {
      return createSkillResult({
        success: false,
        errorCode: 'DELETE_VENUE_FAILED',
        errorMessage: error.message,
      });
    }

    return createSkillResult({ success: true, data: { deleted: true, venueId } });
  }
}
