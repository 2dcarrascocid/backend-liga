/**
 * ADF - Club Finance Specialist (Specialists Layer)
 *
 * Dominio financiero de clubes: el "mantenedor de costos" por temporada
 * (lg_season_cost_catalog) y el libro de ingresos/egresos por club
 * (lg_ledger_entries) — INSCRIPCION y FECHA se generan automáticamente
 * desde tournaments_specialist.js (ver lib/ledger.js); MULTA/OTRO/VALOR
 * son altas manuales de este specialist.
 *
 * DO:
 *   - Reutilizar lib/ledger.js para el cálculo de estado y el catálogo de costos
 *   - Reutilizar lib/club_access.js (assertClubAccess/isOrgAdmin) — nunca
 *     reimplementar el chequeo de rol
 *   - Restringir CREATE_LEDGER_ENTRY, RECORD_PAYMENT y UPSERT_COST_CATALOG
 *     al ADMIN de organización ("solo el administrador puede ingresar
 *     los pagos de los clubes")
 *   - Un admin de club solo puede LISTAR/CONSULTAR el estado de su propio club
 *
 * DON'T:
 *   - No gestionar gastos del organizador (arbitraje/cancha) — eso es de "tournament_costs"
 *   - No gestionar inscripciones/fixture — eso es de "tournaments"
 *   - No lanzar excepciones no controladas
 *
 * Capabilities:
 *   LIST_COST_CATALOG | UPSERT_COST_CATALOG
 *   LIST_LEDGER_ENTRIES | CREATE_LEDGER_ENTRY | RECORD_PAYMENT
 *   GET_CLUB_PAYMENT_STATUS | GET_PAYMENT_STATS
 */

import { Skill } from '../contracts/skill_contract.js';
import { createSkillResult } from '../contracts/task_schema.js';
import { assertClubAccess, isOrgAdmin } from './lib/club_access.js';
import { LEDGER_CATEGORIES, LEDGER_DIRECTIONS, decorateLedgerEntry, computeEntryStatus } from './lib/ledger.js';

const CAPABILITIES = [
  'LIST_COST_CATALOG', 'UPSERT_COST_CATALOG',
  'LIST_LEDGER_ENTRIES', 'CREATE_LEDGER_ENTRY', 'RECORD_PAYMENT',
  'GET_CLUB_PAYMENT_STATUS', 'GET_PAYMENT_STATS',
];

export class ClubFinanceSpecialist extends Skill {
  constructor() {
    super('club_finance_specialist', '1.0.0');
    this.domain = 'club_finance';
    this.capabilities = CAPABILITIES;

    this.contract = {
      input: [
        { name: 'operation', required: true, type: 'string' },
        { name: 'payload', required: true, type: 'object' },
        { name: 'db', required: true, type: 'object' },
        { name: 'userId', required: false, type: 'string' },
      ],
      output: [
        { name: 'catalog', type: 'object' },
        { name: 'entries', type: 'array' },
        { name: 'entry', type: 'object' },
        { name: 'status', type: 'object' },
        { name: 'stats', type: 'object' },
      ],
      rules: {
        do: [
          'Restringir altas manuales y registro de pagos al ADMIN de organización',
          'Calcular el status de cada movimiento en vivo (computeEntryStatus), nunca confiar en un valor guardado',
        ],
        dont: [
          'No gestionar gastos del organizador ni inscripciones/fixture',
        ],
      },
      checklist: [
        'CREATE_LEDGER_ENTRY y RECORD_PAYMENT verifican isOrgAdmin',
        'LIST_LEDGER_ENTRIES/GET_CLUB_PAYMENT_STATUS verifican assertClubAccess cuando hay clubId',
        'GET_PAYMENT_STATS agrupa por club y por serie dentro del club',
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
        case 'LIST_COST_CATALOG':      return this._listCostCatalog(payload, db);
        case 'UPSERT_COST_CATALOG':    return this._upsertCostCatalog(payload, db, userId);
        case 'LIST_LEDGER_ENTRIES':    return this._listLedgerEntries(payload, db, userId);
        case 'CREATE_LEDGER_ENTRY':    return this._createLedgerEntry(payload, db, userId);
        case 'RECORD_PAYMENT':         return this._recordPayment(payload, db, userId);
        case 'GET_CLUB_PAYMENT_STATUS': return this._getClubPaymentStatus(payload, db, userId);
        case 'GET_PAYMENT_STATS':      return this._getPaymentStats(payload, db, userId);
      }
    } catch (err) {
      return createSkillResult({
        success: false,
        errorCode: 'CLUB_FINANCE_SPECIALIST_ERROR',
        errorMessage: err.message,
      });
    }
  }

  // ── Mantenedor de costos por temporada ──────────────────────────────────

  async _listCostCatalog({ seasonId }, db) {
    if (!seasonId) {
      return createSkillResult({ success: false, errorCode: 'MISSING_FIELDS', errorMessage: 'seasonId es requerido' });
    }
    const { data: catalog, error } = await db
      .from('lg_season_cost_catalog').select('*').eq('season_id', seasonId).maybeSingle();
    if (error) {
      return createSkillResult({ success: false, errorCode: 'LIST_COST_CATALOG_FAILED', errorMessage: error.message });
    }
    return createSkillResult({ success: true, data: { catalog: catalog ?? { season_id: seasonId, inscription_fee: 0, matchday_fee: 0 } } });
  }

  async _upsertCostCatalog({ orgId, seasonId, inscriptionFee, matchdayFee }, db, userId) {
    if (!orgId || !seasonId) {
      return createSkillResult({ success: false, errorCode: 'MISSING_FIELDS', errorMessage: 'orgId y seasonId son requeridos' });
    }
    if (!(await isOrgAdmin(userId, orgId, db))) {
      return createSkillResult({ success: false, errorCode: 'FORBIDDEN', errorMessage: 'Solo el administrador de la organización puede configurar el mantenedor de costos' });
    }

    const { data: catalog, error } = await db
      .from('lg_season_cost_catalog')
      .upsert({
        org_id: orgId,
        season_id: seasonId,
        inscription_fee: inscriptionFee ?? 0,
        matchday_fee: matchdayFee ?? 0,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'season_id' })
      .select()
      .single();

    if (error) {
      return createSkillResult({ success: false, errorCode: 'UPSERT_COST_CATALOG_FAILED', errorMessage: error.message });
    }
    return createSkillResult({ success: true, data: { catalog } });
  }

  // ── Libro de ingresos/egresos ────────────────────────────────────────────

  async _listLedgerEntries({ orgId, clubId, seriesId, tournamentId, category, limit = 50 }, db, userId) {
    if (clubId) {
      const accessError = await assertClubAccess(clubId, userId, db);
      if (accessError) {
        return createSkillResult({ success: false, errorCode: accessError, errorMessage: 'No tienes permisos para ver los movimientos de este club' });
      }
    } else {
      if (!orgId || !(await isOrgAdmin(userId, orgId, db))) {
        return createSkillResult({ success: false, errorCode: 'FORBIDDEN', errorMessage: 'Solo el administrador de la organización puede ver el libro completo' });
      }
    }

    let query = db
      .from('lg_ledger_entries')
      .select('*, club:lg_clubs(id,name,short_name), series:lg_club_series(id,name)')
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(limit);

    if (orgId) query = query.eq('org_id', orgId);
    if (clubId) query = query.eq('club_id', clubId);
    if (seriesId) query = query.eq('series_id', seriesId);
    if (tournamentId) query = query.eq('tournament_id', tournamentId);
    if (category) query = query.eq('category', category);

    const { data: entries, error } = await query;
    if (error) {
      return createSkillResult({ success: false, errorCode: 'LIST_LEDGER_ENTRIES_FAILED', errorMessage: error.message });
    }

    return createSkillResult({ success: true, data: { entries: (entries ?? []).map(decorateLedgerEntry) } });
  }

  async _createLedgerEntry({ orgId, clubId, seriesId, tournamentId, category, direction = 'INGRESO', amount, description, dueDate }, db, userId) {
    if (!orgId || !clubId || !category || amount === undefined || amount === null) {
      return createSkillResult({ success: false, errorCode: 'MISSING_FIELDS', errorMessage: 'orgId, clubId, category y amount son requeridos' });
    }
    if (!LEDGER_CATEGORIES.includes(category)) {
      return createSkillResult({ success: false, errorCode: 'INVALID_CATEGORY', errorMessage: `Categoría inválida: "${category}"` });
    }
    if (!LEDGER_DIRECTIONS.includes(direction)) {
      return createSkillResult({ success: false, errorCode: 'INVALID_DIRECTION', errorMessage: `Dirección inválida: "${direction}"` });
    }
    if (!(await isOrgAdmin(userId, orgId, db))) {
      return createSkillResult({ success: false, errorCode: 'FORBIDDEN', errorMessage: 'Solo el administrador de la organización puede registrar movimientos' });
    }

    const { data: entry, error } = await db
      .from('lg_ledger_entries')
      .insert({
        org_id: orgId,
        club_id: clubId,
        series_id: seriesId ?? null,
        tournament_id: tournamentId ?? null,
        category,
        direction,
        amount,
        description: description ?? null,
        due_date: dueDate ?? null,
      })
      .select('*, club:lg_clubs(id,name,short_name), series:lg_club_series(id,name)')
      .single();

    if (error) {
      return createSkillResult({ success: false, errorCode: 'CREATE_LEDGER_ENTRY_FAILED', errorMessage: error.message });
    }
    return createSkillResult({ success: true, data: { entry: decorateLedgerEntry(entry) } });
  }

  async _recordPayment({ entryId, amount }, db, userId) {
    if (!entryId || !amount || amount <= 0) {
      return createSkillResult({ success: false, errorCode: 'MISSING_FIELDS', errorMessage: 'entryId y amount (> 0) son requeridos' });
    }

    const { data: existing } = await db.from('lg_ledger_entries').select('*').eq('id', entryId).maybeSingle();
    if (!existing) {
      return createSkillResult({ success: false, errorCode: 'ENTRY_NOT_FOUND', errorMessage: 'Movimiento no encontrado' });
    }
    if (!(await isOrgAdmin(userId, existing.org_id, db))) {
      return createSkillResult({ success: false, errorCode: 'FORBIDDEN', errorMessage: 'Solo el administrador de la organización puede registrar pagos' });
    }

    const newPaidAmount = Number(existing.paid_amount || 0) + Number(amount);

    const { data: entry, error } = await db
      .from('lg_ledger_entries')
      .update({
        paid_amount: newPaidAmount,
        paid_at: new Date().toISOString(),
        recorded_by: userId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', entryId)
      .select('*, club:lg_clubs(id,name,short_name), series:lg_club_series(id,name)')
      .single();

    if (error) {
      return createSkillResult({ success: false, errorCode: 'RECORD_PAYMENT_FAILED', errorMessage: error.message });
    }
    return createSkillResult({ success: true, data: { entry: decorateLedgerEntry(entry) } });
  }

  // ── Estado de pago / estadísticas ────────────────────────────────────────

  /** Agrega un set de filas de lg_ledger_entries en los totales de estado de pago. */
  _aggregatePaymentStatus(rows) {
    let totalCharged = 0;
    let totalPaid = 0;
    let overdueAmount = 0;
    let egresosTotal = 0;

    for (const row of rows) {
      const amount = Number(row.amount) || 0;
      const paid = Number(row.paid_amount) || 0;

      if (row.direction === 'EGRESO') {
        egresosTotal += amount;
        continue;
      }
      totalCharged += amount;
      totalPaid += paid;
      if (computeEntryStatus(row) === 'VENCIDO') overdueAmount += (amount - paid);
    }

    const totalPending = Math.max(0, totalCharged - totalPaid);
    const status = overdueAmount > 0 ? 'MOROSO' : (totalPending > 0 ? 'PENDIENTE' : 'AL_DIA');

    return {
      total_charged: totalCharged,
      total_paid: totalPaid,
      total_pending: totalPending,
      overdue_amount: overdueAmount,
      egresos_total: egresosTotal,
      status,
    };
  }

  async _getClubPaymentStatus({ clubId }, db, userId) {
    if (!clubId) {
      return createSkillResult({ success: false, errorCode: 'MISSING_FIELDS', errorMessage: 'clubId es requerido' });
    }
    const accessError = await assertClubAccess(clubId, userId, db);
    if (accessError) {
      return createSkillResult({ success: false, errorCode: accessError, errorMessage: 'No tienes permisos para ver el estado de pago de este club' });
    }

    const { data: rows, error } = await db
      .from('lg_ledger_entries').select('amount, paid_amount, direction, due_date').eq('club_id', clubId);
    if (error) {
      return createSkillResult({ success: false, errorCode: 'GET_CLUB_PAYMENT_STATUS_FAILED', errorMessage: error.message });
    }

    return createSkillResult({ success: true, data: { status: { club_id: clubId, ...this._aggregatePaymentStatus(rows ?? []) } } });
  }

  /** "Módulo de estadísticas de quiénes pagaron": por club, y por serie dentro del club. */
  async _getPaymentStats({ orgId }, db, userId) {
    if (!orgId) {
      return createSkillResult({ success: false, errorCode: 'MISSING_ORG', errorMessage: 'orgId es requerido' });
    }
    if (!(await isOrgAdmin(userId, orgId, db))) {
      return createSkillResult({ success: false, errorCode: 'FORBIDDEN', errorMessage: 'Solo el administrador de la organización puede ver las estadísticas de pago' });
    }

    const [{ data: clubs }, { data: rows }] = await Promise.all([
      db.from('lg_clubs').select('id,name,short_name').eq('org_id', orgId),
      db.from('lg_ledger_entries')
        .select('club_id, series_id, amount, paid_amount, direction, due_date, series:lg_club_series(name)')
        .eq('org_id', orgId),
    ]);

    const rowsByClub = new Map();
    for (const row of rows ?? []) {
      if (!rowsByClub.has(row.club_id)) rowsByClub.set(row.club_id, []);
      rowsByClub.get(row.club_id).push(row);
    }

    const byClub = (clubs ?? []).map((club) => {
      const clubRows = rowsByClub.get(club.id) ?? [];

      const rowsBySeries = new Map();
      for (const row of clubRows) {
        const key = row.series_id ?? '_sin_serie';
        if (!rowsBySeries.has(key)) rowsBySeries.set(key, { series_id: row.series_id, series_name: row.series?.name ?? null, rows: [] });
        rowsBySeries.get(key).rows.push(row);
      }

      const series = Array.from(rowsBySeries.values()).map((s) => ({
        series_id: s.series_id,
        series_name: s.series_name,
        ...this._aggregatePaymentStatus(s.rows),
      }));

      return {
        club_id: club.id,
        club_name: club.name,
        club_short_name: club.short_name,
        series,
        ...this._aggregatePaymentStatus(clubRows),
      };
    });

    const orgTotals = byClub.reduce((acc, c) => ({
      total_charged: acc.total_charged + c.total_charged,
      total_paid: acc.total_paid + c.total_paid,
      total_pending: acc.total_pending + c.total_pending,
      overdue_amount: acc.overdue_amount + c.overdue_amount,
    }), { total_charged: 0, total_paid: 0, total_pending: 0, overdue_amount: 0 });

    return createSkillResult({
      success: true,
      data: {
        stats: {
          org_id: orgId,
          clubs_al_dia: byClub.filter((c) => c.status === 'AL_DIA').length,
          clubs_pendientes: byClub.filter((c) => c.status === 'PENDIENTE').length,
          clubs_morosos: byClub.filter((c) => c.status === 'MOROSO').length,
          ...orgTotals,
          by_club: byClub,
        },
      },
    });
  }
}
