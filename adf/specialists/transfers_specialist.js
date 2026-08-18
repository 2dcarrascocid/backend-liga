/**
 * ADF - Transfers Specialist (Specialists Layer)
 *
 * Módulo de Transferencias de Jugadores y KPIs para Fair Play Chile.
 * Maneja el ciclo de vida completo: PENDING / ENVIADO → APPROVED / ACEPTADO | REJECTED / RECHAZADO | CANCELLED / CANCELADO.
 * Soporta paginación por token para listado y cálculo de KPIs globales y por club.
 *
 * Capabilities:
 *   LIST_TRANSFERS | GET_TRANSFER | CREATE_TRANSFER | UPDATE_TRANSFER_STATUS |
 *   ACCEPT_TRANSFER | REJECT_TRANSFER | CANCEL_TRANSFER |
 *   GET_KPIS_SUMMARY | GET_KPIS_CLUB
 */

import { Skill } from '../contracts/skill_contract.js';
import { createSkillResult } from '../contracts/task_schema.js';
import { encodeNext, decodeNext } from '../../utils/pagination.js';

const CAPABILITIES = [
  'LIST_TRANSFERS',
  'GET_TRANSFER',
  'CREATE_TRANSFER',
  'UPDATE_TRANSFER_STATUS',
  'ACCEPT_TRANSFER',
  'REJECT_TRANSFER',
  'CANCEL_TRANSFER',
  'GET_KPIS_SUMMARY',
  'GET_KPIS_CLUB',
];

export class TransfersSpecialist extends Skill {
  constructor() {
    super('transfers_specialist', '2.0.0');
    this.domain = 'transfers';
    this.capabilities = CAPABILITIES;

    this.contract = {
      input: [
        { name: 'operation', required: true,  type: 'string' },
        { name: 'payload',   required: true,  type: 'object' },
        { name: 'db',        required: true,  type: 'object' },
        { name: 'userId',    required: false, type: 'string' },
      ],
      output: [
        { name: 'transfer',       type: 'object' },
        { name: 'data',           type: 'array'  },
        { name: 'next_token',     type: 'string' },
        { name: 'total_registros',type: 'number' },
        { name: 'limit',          type: 'number' },
        { name: 'summary',        type: 'object' },
        { name: 'club_kpis',      type: 'object' },
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
        case 'LIST_TRANSFERS':          return this._listTransfers(payload, db);
        case 'GET_TRANSFER':            return this._getTransfer(payload, db);
        case 'CREATE_TRANSFER':         return this._createTransfer(payload, db, userId);
        case 'UPDATE_TRANSFER_STATUS':  return this._updateTransferStatus(payload, db, userId);
        case 'ACCEPT_TRANSFER':         return this._updateTransferStatus({ ...payload, status: 'APPROVED' }, db, userId);
        case 'REJECT_TRANSFER':         return this._updateTransferStatus({ ...payload, status: 'REJECTED' }, db, userId);
        case 'CANCEL_TRANSFER':         return this._updateTransferStatus({ ...payload, status: 'CANCELLED' }, db, userId);
        case 'GET_KPIS_SUMMARY':        return this._getKpisSummary(payload, db);
        case 'GET_KPIS_CLUB':           return this._getKpisClub(payload, db);
      }
    } catch (err) {
      return createSkillResult({
        success: false,
        errorCode: 'TRANSFERS_SPECIALIST_ERROR',
        errorMessage: err.message,
      });
    }
  }

  // ── Helper: Obtener folio libre en club destino ─────────────────────────────

  async _getAvailableFolio(clubId, db) {
    const { data: club, error: clubErr } = await db
      .from('lg_clubs')
      .select('folio_start, folio_end, max_players')
      .eq('id', clubId)
      .single();

    if (clubErr || !club) return { error: { code: 'CLUB_NOT_FOUND', message: 'Club destino no encontrado' } };

    const folioStart = club.folio_start ?? 1;
    const folioEnd   = club.folio_end   ?? 70;
    const maxPlayers = club.max_players ?? 70;

    const { count: activeCount } = await db
      .from('lg_club_rosters')
      .select('id', { count: 'exact', head: true })
      .eq('club_id', clubId)
      .eq('status', 'ACTIVE');

    if (activeCount >= maxPlayers) {
      return { error: { code: 'ROSTER_FULL', message: `El club destino está lleno (máx. ${maxPlayers} jugadores activos)` } };
    }

    const { data: usedRows } = await db
      .from('lg_club_rosters')
      .select('club_folio')
      .eq('club_id', clubId)
      .eq('status', 'ACTIVE')
      .not('club_folio', 'is', null);

    const used = new Set((usedRows ?? []).map(r => r.club_folio));

    let assignedFolio = null;
    for (let f = folioStart; f <= folioEnd; f++) {
      if (!used.has(f)) { assignedFolio = f; break; }
    }

    if (assignedFolio === null) {
      return { error: { code: 'NO_FOLIO_AVAILABLE', message: 'No hay folios disponibles en el club destino' } };
    }

    return { assignedFolio };
  }

  // ── 1. LIST_TRANSFERS (Token-based pagination & filters) ───────────────────

  async _listTransfers({ playerId, originClubId, destinationClubId, status, limit: limitRaw, nextToken, clubId }, db) {
    const limit = Math.min(Math.max(parseInt(limitRaw || 10, 10), 1), 100);

    let offset = 0;
    if (nextToken) {
      const decoded = decodeNext(nextToken);
      if (decoded && typeof decoded.offset === 'number') {
        offset = decoded.offset;
      }
    }

    let query = db
      .from('lg_transfers')
      .select(`
        *,
        player:lg_players(id, first_name, last_name, rut, birth_date, photo_url, position),
        origin_club:lg_clubs!from_club_id(id, name, short_name, logo_url),
        destination_club:lg_clubs!to_club_id(id, name, short_name, logo_url)
      `, { count: 'exact' });

    if (playerId) {
      query = query.eq('player_id', playerId);
    }
    if (originClubId) {
      query = query.eq('from_club_id', originClubId);
    }
    if (destinationClubId) {
      query = query.eq('to_club_id', destinationClubId);
    }
    if (clubId && !originClubId && !destinationClubId) {
      query = query.or(`from_club_id.eq.${clubId},to_club_id.eq.${clubId}`);
    }
    if (status) {
      // Mapear equivalencias PENDING/ENVIADO, APPROVED/ACEPTADO, REJECTED/RECHAZADO, CANCELLED/CANCELADO
      const upperStatus = status.toUpperCase();
      if (upperStatus === 'PENDING' || upperStatus === 'ENVIADO') {
        query = query.in('status', ['PENDING', 'ENVIADO']);
      } else if (upperStatus === 'APPROVED' || upperStatus === 'ACEPTADO') {
        query = query.in('status', ['APPROVED', 'ACEPTADO']);
      } else if (upperStatus === 'REJECTED' || upperStatus === 'RECHAZADO') {
        query = query.in('status', ['REJECTED', 'RECHAZADO']);
      } else if (upperStatus === 'CANCELLED' || upperStatus === 'CANCELADO') {
        query = query.in('status', ['CANCELLED', 'CANCELADO']);
      } else {
        query = query.eq('status', status);
      }
    }

    query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

    const { data, count, error } = await query;

    if (error) {
      return createSkillResult({ success: false, errorCode: 'LIST_TRANSFERS_FAILED', errorMessage: error.message });
    }

    const totalCount = count ?? 0;
    const next_token = (offset + limit < totalCount) ? encodeNext(offset + limit, limit) : null;

    return createSkillResult({
      success: true,
      data: {
        data: data ?? [],
        next_token,
        total_registros: totalCount,
        limit,
      },
    });
  }

  // ── 2. GET_TRANSFER ────────────────────────────────────────────────────────

  async _getTransfer({ transferId }, db) {
    const { data, error } = await db
      .from('lg_transfers')
      .select(`
        *,
        player:lg_players(id, first_name, last_name, rut, birth_date, photo_url, position, club_id, club_folio),
        origin_club:lg_clubs!from_club_id(id, name, short_name, logo_url),
        destination_club:lg_clubs!to_club_id(id, name, short_name, logo_url)
      `)
      .eq('id', transferId)
      .single();

    if (error || !data) {
      return createSkillResult({ success: false, errorCode: 'TRANSFER_NOT_FOUND', errorMessage: 'Transferencia no encontrada' });
    }

    return createSkillResult({ success: true, data: { transfer: data } });
  }

  // ── 3. CREATE_TRANSFER ─────────────────────────────────────────────────────

  async _createTransfer({ playerId, originClubId, destinationClubId, fee, notes, transferDate, requestedBy }, db, userId) {
    const fromClubId = originClubId;
    const toClubId   = destinationClubId;

    if (!playerId || !fromClubId || !toClubId) {
      return createSkillResult({
        success: false,
        errorCode: 'MISSING_FIELDS',
        errorMessage: 'player_id (o playerId), origin_club_id y destination_club_id son requeridos',
      });
    }

    if (fromClubId === toClubId) {
      return createSkillResult({
        success: false,
        errorCode: 'SAME_CLUB',
        errorMessage: 'El club destino debe ser distinto al club origen',
      });
    }

    // Verificar que el jugador esté activo en el club origen
    const { data: roster, error: rosterError } = await db
      .from('lg_club_rosters')
      .select('id, status')
      .eq('club_id', fromClubId)
      .eq('player_id', playerId)
      .eq('status', 'ACTIVE')
      .maybeSingle();

    if (rosterError || !roster) {
      return createSkillResult({
        success: false,
        errorCode: 'PLAYER_NOT_IN_CLUB',
        errorMessage: 'El jugador no tiene un roster activo en el club origen',
      });
    }

    // Verificar que no haya un traspaso pendiente para el jugador
    const { data: pending } = await db
      .from('lg_transfers')
      .select('id')
      .eq('player_id', playerId)
      .in('status', ['PENDING', 'ENVIADO'])
      .maybeSingle();

    if (pending) {
      return createSkillResult({
        success: false,
        errorCode: 'TRANSFER_PENDING',
        errorMessage: 'El jugador ya posee una solicitud de transferencia pendiente',
      });
    }

    // Obtener org_id del club origen
    const { data: club } = await db
      .from('lg_clubs')
      .select('org_id')
      .eq('id', fromClubId)
      .single();

    const numericFee = fee ? parseFloat(fee) : 0.00;

    const { data: transfer, error } = await db
      .from('lg_transfers')
      .insert({
        org_id:        club?.org_id ?? null,
        player_id:     playerId,
        from_club_id:  fromClubId,
        to_club_id:    toClubId,
        transfer_date: transferDate ? new Date(transferDate).toISOString() : new Date().toISOString(),
        fee:           numericFee,
        status:        'PENDING',
        requested_by:  requestedBy ?? userId ?? null,
        notes:         notes ?? null,
      })
      .select(`
        *,
        player:lg_players(id, first_name, last_name, rut),
        origin_club:lg_clubs!from_club_id(id, name),
        destination_club:lg_clubs!to_club_id(id, name)
      `)
      .single();

    if (error) {
      return createSkillResult({ success: false, errorCode: 'CREATE_TRANSFER_FAILED', errorMessage: error.message });
    }

    return createSkillResult({ success: true, data: { transfer } });
  }

  // ── 4. UPDATE_TRANSFER_STATUS (APPROVED, REJECTED, CANCELLED) ──────────────

  async _updateTransferStatus({ transferId, status, approvedBy, notes }, db, userId) {
    if (!transferId || !status) {
      return createSkillResult({ success: false, errorCode: 'MISSING_FIELDS', errorMessage: 'transferId y status son requeridos' });
    }

    const normStatus = status.toUpperCase();
    const isApprove = normStatus === 'APPROVED' || normStatus === 'ACEPTADO';
    const isReject  = normStatus === 'REJECTED' || normStatus === 'RECHAZADO';
    const isCancel  = normStatus === 'CANCELLED' || normStatus === 'CANCELADO';

    if (!isApprove && !isReject && !isCancel) {
      return createSkillResult({
        success: false,
        errorCode: 'INVALID_STATUS',
        errorMessage: 'Estado no válido. Use APPROVED, REJECTED o CANCELLED',
      });
    }

    // Obtener la transferencia actual
    const { data: transfer, error: fetchErr } = await db
      .from('lg_transfers')
      .select('*')
      .eq('id', transferId)
      .single();

    if (fetchErr || !transfer) {
      return createSkillResult({ success: false, errorCode: 'TRANSFER_NOT_FOUND', errorMessage: 'Transferencia no encontrada' });
    }

    if (transfer.status !== 'PENDING' && transfer.status !== 'ENVIADO') {
      return createSkillResult({
        success: false,
        errorCode: 'TRANSFER_ALREADY_PROCESSED',
        errorMessage: `La transferencia ya se encuentra en estado ${transfer.status}`,
      });
    }

    const targetStatus = isApprove ? 'APPROVED' : (isReject ? 'REJECTED' : 'CANCELLED');
    const approver = approvedBy ?? userId ?? null;

    if (isApprove) {
      // 1. Obtener folio disponible en club destino
      const folioRes = await this._getAvailableFolio(transfer.to_club_id, db);
      if (folioRes.error) {
        return createSkillResult({ success: false, errorCode: folioRes.error.code, errorMessage: folioRes.error.message });
      }
      const { assignedFolio } = folioRes;

      // 2. Desactivar roster en club origen
      const { error: deactErr } = await db
        .from('lg_club_rosters')
        .update({ status: 'INACTIVE', valid_to: new Date().toISOString() })
        .eq('player_id', transfer.player_id)
        .eq('club_id', transfer.from_club_id)
        .eq('status', 'ACTIVE');

      if (deactErr) {
        return createSkillResult({ success: false, errorCode: 'ROSTER_UPDATE_FAILED', errorMessage: deactErr.message });
      }

      // 3. Crear nuevo roster activo en club destino
      const { error: rostErr } = await db
        .from('lg_club_rosters')
        .insert({
          club_id:    transfer.to_club_id,
          player_id:  transfer.player_id,
          status:     'ACTIVE',
          valid_from: new Date().toISOString(),
          club_folio: assignedFolio,
        });

      if (rostErr) {
        // Rollback desactivación
        await db
          .from('lg_club_rosters')
          .update({ status: 'ACTIVE', valid_to: null })
          .eq('player_id', transfer.player_id)
          .eq('club_id', transfer.from_club_id);

        return createSkillResult({ success: false, errorCode: 'ROSTER_CREATE_FAILED', errorMessage: rostErr.message });
      }

      // 4. Actualizar registro principal del jugador en lg_players
      await db
        .from('lg_players')
        .update({ club_id: transfer.to_club_id, club_folio: assignedFolio, updated_at: new Date().toISOString() })
        .eq('id', transfer.player_id);
    }

    // Actualizar estado en lg_transfers
    const updateData = {
      status: targetStatus,
      updated_at: new Date().toISOString(),
    };
    if (isApprove) {
      updateData.approved_by = approver;
    }
    if (notes) {
      updateData.notes = notes;
    }

    const { data: updated, error: updErr } = await db
      .from('lg_transfers')
      .update(updateData)
      .eq('id', transferId)
      .select(`
        *,
        player:lg_players(id, first_name, last_name, rut),
        origin_club:lg_clubs!from_club_id(id, name),
        destination_club:lg_clubs!to_club_id(id, name)
      `)
      .single();

    if (updErr) {
      return createSkillResult({ success: false, errorCode: 'UPDATE_STATUS_FAILED', errorMessage: updErr.message });
    }

    return createSkillResult({ success: true, data: { transfer: updated } });
  }

  // ── 5. GET_KPIS_SUMMARY (Métricas globales del período) ─────────────────────

  async _getKpisSummary(_payload, db) {
    const { data: allTransfers, error } = await db
      .from('lg_transfers')
      .select(`
        id,
        from_club_id,
        to_club_id,
        fee,
        status,
        created_at,
        updated_at,
        origin_club:lg_clubs!from_club_id(id, name),
        destination_club:lg_clubs!to_club_id(id, name)
      `);

    if (error) {
      return createSkillResult({ success: false, errorCode: 'GET_KPIS_FAILED', errorMessage: error.message });
    }

    const transfers = allTransfers ?? [];
    const total_transfers = transfers.length;

    // Distribución por estado
    const by_status = {
      APPROVED: 0,
      PENDING: 0,
      REJECTED: 0,
      CANCELLED: 0,
    };

    let total_fee_amount = 0;
    let totalResolutionDaysSum = 0;
    let resolvedCount = 0;

    const originCounts = {};
    const destCounts = {};

    transfers.forEach((t) => {
      const st = t.status.toUpperCase();
      if (st === 'APPROVED' || st === 'ACEPTADO') {
        by_status.APPROVED += 1;
        total_fee_amount += parseFloat(t.fee || 0);

        // Conteo de altas y bajas por club (para aprobadas)
        if (t.from_club_id) {
          const clubName = t.origin_club?.name || t.from_club_id;
          originCounts[t.from_club_id] = originCounts[t.from_club_id] || { id: t.from_club_id, name: clubName, count: 0 };
          originCounts[t.from_club_id].count += 1;
        }

        if (t.to_club_id) {
          const clubName = t.destination_club?.name || t.to_club_id;
          destCounts[t.to_club_id] = destCounts[t.to_club_id] || { id: t.to_club_id, name: clubName, count: 0 };
          destCounts[t.to_club_id].count += 1;
        }
      } else if (st === 'PENDING' || st === 'ENVIADO') {
        by_status.PENDING += 1;
      } else if (st === 'REJECTED' || st === 'RECHAZADO') {
        by_status.REJECTED += 1;
      } else if (st === 'CANCELLED' || st === 'CANCELADO') {
        by_status.CANCELLED += 1;
      }

      // Promedio días de resolución
      if (st !== 'PENDING' && st !== 'ENVIADO' && t.created_at && t.updated_at) {
        const created = new Date(t.created_at).getTime();
        const updated = new Date(t.updated_at).getTime();
        const diffDays = Math.max((updated - created) / (1000 * 60 * 60 * 24), 0);
        totalResolutionDaysSum += diffDays;
        resolvedCount += 1;
      }
    });

    // Encontrar clubes con mayor actividad
    const top_destination_club = Object.values(destCounts).sort((a, b) => b.count - a.count)[0] || null;
    const top_origin_club      = Object.values(originCounts).sort((a, b) => b.count - a.count)[0] || null;

    const avg_resolution_days = resolvedCount > 0 ? parseFloat((totalResolutionDaysSum / resolvedCount).toFixed(1)) : 0;

    return createSkillResult({
      success: true,
      data: {
        summary: {
          total_transfers,
          by_status,
          total_fee_amount,
          avg_resolution_days,
          top_destination_club,
          top_origin_club,
        },
      },
    });
  }

  // ── 6. GET_KPIS_CLUB (Indicadores específicos por club) ────────────────────

  async _getKpisClub({ clubId }, db) {
    if (!clubId) {
      return createSkillResult({ success: false, errorCode: 'MISSING_FIELDS', errorMessage: 'clubId es requerido' });
    }

    const { data: transfers, error } = await db
      .from('lg_transfers')
      .select('id, from_club_id, to_club_id, fee, status')
      .or(`from_club_id.eq.${clubId},to_club_id.eq.${clubId}`);

    if (error) {
      return createSkillResult({ success: false, errorCode: 'GET_CLUB_KPIS_FAILED', errorMessage: error.message });
    }

    let purchases = 0;
    let sales = 0;
    let total_spent = 0;
    let total_revenue = 0;

    (transfers ?? []).forEach((t) => {
      const st = t.status.toUpperCase();
      const isApproved = st === 'APPROVED' || st === 'ACEPTADO';
      const feeVal = parseFloat(t.fee || 0);

      if (t.to_club_id === clubId && isApproved) {
        purchases += 1;
        total_spent += feeVal;
      }
      if (t.from_club_id === clubId && isApproved) {
        sales += 1;
        total_revenue += feeVal;
      }
    });

    return createSkillResult({
      success: true,
      data: {
        club_kpis: {
          club_id: clubId,
          purchases,
          sales,
          total_spent,
          total_revenue,
          net_balance: total_revenue - total_spent,
        },
      },
    });
  }
}
