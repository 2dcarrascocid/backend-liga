/**
 * ADF - Categories Specialist (Specialists Layer)
 *
 * Ejecuta operaciones del dominio de categorías de edad.
 * Maneja: listado, creación, actualización y eliminación de categorías por organización.
 *
 * DO:
 *   - Operar sobre lg_categories
 *   - Filtrar siempre por org_id (las categorías son a nivel de organización)
 *   - Ordenar listados por age_from ASC
 *
 * DON'T:
 *   - No filtrar por club_id (la tabla no tiene esa columna)
 *   - No manejar asignación de jugadores a categorías — eso es por rango de edad
 *   - No lanzar excepciones no controladas
 *
 * Capabilities:
 *   LIST_CATEGORIES | CREATE_CATEGORY | UPDATE_CATEGORY | DELETE_CATEGORY
 *
 * Checklist:
 *   [ ] ¿LIST filtra por org_id y ordena por age_from?
 *   [ ] ¿CREATE incluye color, age_from, age_to, description?
 *   [ ] ¿UPDATE solo modifica campos permitidos?
 *   [ ] ¿DELETE verifica que la categoría pertenece a la org?
 */

import { Skill } from '../contracts/skill_contract.js';
import { createSkillResult } from '../contracts/task_schema.js';

const CAPABILITIES = [
  'LIST_CATEGORIES',
  'CREATE_CATEGORY',
  'UPDATE_CATEGORY',
  'DELETE_CATEGORY',
];

export class CategoriesSpecialist extends Skill {
  constructor() {
    super('categories_specialist', '1.0.0');
    this.domain = 'categories';
    this.capabilities = CAPABILITIES;

    this.contract = {
      input: [
        { name: 'operation', required: true,  type: 'string' },
        { name: 'payload',   required: true,  type: 'object' },
        { name: 'db',        required: true,  type: 'object' },
        { name: 'userId',    required: false, type: 'string' },
      ],
      output: [
        { name: 'category',   type: 'object' },
        { name: 'categories', type: 'array'  },
      ],
      rules: {
        do: [
          'Filtrar siempre por org_id en LIST y DELETE',
          'Ordenar por age_from ASC en LIST_CATEGORIES',
          'Permitir color en CREATE y UPDATE',
        ],
        dont: [
          'No filtrar por club_id (la tabla no tiene esa columna)',
          'No gestionar jugadores desde este specialist',
        ],
      },
      checklist: [
        'LIST_CATEGORIES ordena por age_from ASC',
        'CREATE_CATEGORY incluye org_id derivado del club',
        'DELETE verifica existencia antes de eliminar',
        'UPDATE solo modifica campos permitidos',
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
        case 'LIST_CATEGORIES':   return this._listCategories(payload, db);
        case 'CREATE_CATEGORY':   return this._createCategory(payload, db);
        case 'UPDATE_CATEGORY':   return this._updateCategory(payload, db);
        case 'DELETE_CATEGORY':   return this._deleteCategory(payload, db);
      }
    } catch (err) {
      return createSkillResult({
        success: false,
        errorCode: 'CATEGORIES_SPECIALIST_ERROR',
        errorMessage: err.message,
      });
    }
  }

  async _listCategories({ orgId }, db) {
    const { data: categories, error } = await db
      .from('lg_categories')
      .select('*')
      .eq('org_id', orgId)
      .order('age_from', { ascending: true, nullsFirst: true });

    if (error) {
      return createSkillResult({
        success: false,
        errorCode: 'LIST_CATEGORIES_FAILED',
        errorMessage: error.message,
      });
    }

    return createSkillResult({ success: true, data: { categories } });
  }

  async _createCategory({ orgId, name, color, ageFrom, ageTo, description }, db) {
    if (!orgId || !name) {
      return createSkillResult({
        success: false,
        errorCode: 'MISSING_FIELDS',
        errorMessage: 'org_id y name son requeridos',
      });
    }

    const { data: category, error } = await db
      .from('lg_categories')
      .insert({
        org_id:      orgId,
        name,
        color:       color       ?? '#6366f1',
        age_from:    ageFrom     ?? null,
        age_to:      ageTo       ?? null,
        description: description ?? null,
      })
      .select()
      .single();

    if (error) {
      return createSkillResult({
        success: false,
        errorCode: 'CREATE_CATEGORY_FAILED',
        errorMessage: error.message,
      });
    }

    return createSkillResult({ success: true, data: { category } });
  }

  async _updateCategory({ categoryId, name, color, ageFrom, ageTo, description }, db) {
    const allowed = { name, color, age_from: ageFrom, age_to: ageTo, description };
    const patch = Object.fromEntries(
      Object.entries(allowed).filter(([, v]) => v !== undefined)
    );

    if (Object.keys(patch).length === 0) {
      return createSkillResult({
        success: false,
        errorCode: 'NO_FIELDS',
        errorMessage: 'No hay campos válidos para actualizar',
      });
    }

    const { data: category, error } = await db
      .from('lg_categories')
      .update(patch)
      .eq('id', categoryId)
      .select()
      .single();

    if (error) {
      return createSkillResult({
        success: false,
        errorCode: 'UPDATE_CATEGORY_FAILED',
        errorMessage: error.message,
      });
    }

    return createSkillResult({ success: true, data: { category } });
  }

  async _deleteCategory({ categoryId, orgId }, db) {
    // Verificar que pertenece a la org
    const { data: existing, error: fetchErr } = await db
      .from('lg_categories')
      .select('id')
      .eq('id', categoryId)
      .eq('org_id', orgId)
      .maybeSingle();

    if (fetchErr || !existing) {
      return createSkillResult({
        success: false,
        errorCode: 'CATEGORY_NOT_FOUND',
        errorMessage: 'Categoría no encontrada en esta organización',
      });
    }

    const { error } = await db
      .from('lg_categories')
      .delete()
      .eq('id', categoryId);

    if (error) {
      return createSkillResult({
        success: false,
        errorCode: 'DELETE_CATEGORY_FAILED',
        errorMessage: error.message,
      });
    }

    return createSkillResult({ success: true, data: { deleted: true, categoryId } });
  }
}
