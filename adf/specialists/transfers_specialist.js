/**
 * ADF - Transfers Specialist (Specialists Layer)
 *
 * Ejecuta operaciones del dominio de traspasos de jugadores entre clubes.
 * Maneja el ciclo de vida completo: ENVIADO → ACEPTADO / RECHAZADO, cancelación.
 *
 * DO:
 *   - Operar sobre lg_transfers y lg_club_rosters
 *   - En ACCEPT_TRANSFER:
 *       1. Desactivar roster origen (libera el folio del club origen)
 *       2. Buscar primer folio libre en club destino (solo entre rosters ACTIVE)
 *       3. Crear roster destino con folio asignado
 *       4. Actualizar club_folio y club_id en lg_players
 *   - En CREATE_TRANSFER: validar que el jugador esté ACTIVE en el club origen
 *   - En CREATE_TRANSFER: verificar que no exista otro traspaso ENVIADO para el mismo jugador
 *   - Solo el club destino puede ACCEPT/REJECT; solo el club origen puede CANCEL
 *
 * DON'T:
 *   - No procesar traspasos en estado distinto de ENVIADO en accept/reject/cancel
 *   - No permitir traspaso al mismo club
 *   - No crear roster destino sin folio asignado
 *   - No lanzar excepciones no controladas
 *
 * Reglas de folio en ACCEPT:
 *   - Los rosters INACTIVE no cuentan como folio ocupado
 *   - Si el club destino no tiene folios disponibles → error antes de cualquier cambio
 *   - El folio asignado se guarda en lg_club_rosters.club_folio y en lg_players.club_folio
 *
 * Capabilities:
 *   LIST_TRANSFERS | CREATE_TRANSFER | ACCEPT_TRANSFER | REJECT_TRANSFER | CANCEL_TRANSFER
 *
 * Checklist:
 *   [x] ¿CREATE valida jugador ACTIVE en club origen?
 *   [x] ¿CREATE verifica que no haya traspaso ENVIADO pendiente?
 *   [x] ¿ACCEPT verifica cupo y folios disponibles en club destino antes de modificar?
 *   [x] ¿ACCEPT desactiva roster origen (libera folio)?
 *   [x] ¿ACCEPT crea roster destino con folio asignado?
 *   [x] ¿ACCEPT actualiza club_folio y club_id en lg_players?
 *   [x] ¿ACCEPT revierte desactivación si falla la creación del roster destino?
 *   [x] ¿ACCEPT/REJECT solo aplica si to_club_id coincide?
 *   [x] ¿CANCEL solo aplica si from_club_id coincide y status = ENVIADO?
 */

import { Skill } from '../contracts/skill_contract.js';
import { createSkillResult } from '../contracts/task_schema.js';

const CAPABILITIES = [
  'LIST_TRANSFERS',
  'CREATE_TRANSFER',
  'ACCEPT_TRANSFER',
  'REJECT_TRANSFER',
  'CANCEL_TRANSFER',
];

export class TransfersSpecialist extends Skill {
  constructor() {
    super('transfers_specialist', '1.1.0');
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
        { name: 'transfer',      type: 'object' },
        { name: 'outgoing',      type: 'array'  },
        { name: 'incoming',      type: 'array'  },
        { name: 'assignedFolio', type: 'number' },
      ],
      rules: {
        do: [
          'Separar traspasos en outgoing (from_club) e incoming (to_club) en LIST',
          'Validar jugador ACTIVE en club origen antes de crear traspaso',
          'Verificar traspaso pendiente antes de crear uno nuevo',
          'En ACCEPT: verificar cupo y folios libres en destino ANTES de modificar datos',
          'En ACCEPT: desactivar roster origen, crear roster destino con folio, actualizar lg_players',
          'En ACCEPT: revertir si falla la creación del roster destino',
          'Solo club destino puede aceptar/rechazar; solo club origen puede cancelar',
        ],
        dont: [
          'No procesar traspasos que no estén en estado ENVIADO',
          'No permitir traspaso al mismo club',
          'No crear roster destino sin folio asignado',
        ],
      },
      checklist: [
        'CREATE valida roster ACTIVE en from_club',
        'CREATE verifica que no haya traspaso ENVIADO duplicado',
        'ACCEPT verifica cupo y folios disponibles antes de modificar',
        'ACCEPT libera folio en origen (roster INACTIVE) y asigna folio en destino',
        'ACCEPT actualiza club_folio y club_id en lg_players',
        'REJECT y CANCEL solo aplican a estado ENVIADO',
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
        case 'LIST_TRANSFERS':   return this._listTransfers(payload, db);
        case 'CREATE_TRANSFER':  return this._createTransfer(payload, db);
        case 'ACCEPT_TRANSFER':  return this._acceptTransfer(payload, db);
        case 'REJECT_TRANSFER':  return this._rejectTransfer(payload, db);
        case 'CANCEL_TRANSFER':  return this._cancelTransfer(payload, db);
      }
    } catch (err) {
      return createSkillResult({
        success: false,
        errorCode: 'TRANSFERS_SPECIALIST_ERROR',
        errorMessage: err.message,
      });
    }
  }

  // ── Helper: folio libre en un club ───────────────────────────────────────

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

    // Verificar cupo en destino
    const { count: activeCount } = await db
      .from('lg_club_rosters')
      .select('id', { count: 'exact', head: true })
      .eq('club_id', clubId)
      .eq('status', 'ACTIVE');

    if (activeCount >= maxPlayers) {
      return { error: { code: 'ROSTER_FULL', message: `El club destino está lleno (máx. ${maxPlayers} jugadores activos)` } };
    }

    // Folios ocupados (solo ACTIVE — los INACTIVE quedan libres)
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

  // ── Operations ───────────────────────────────────────────────────────────

  async _listTransfers({ clubId }, db) {
    const { data, error } = await db
      .from('lg_transfers')
      .select(`
        *,
        player:lg_players(id, first_name, last_name, rut, birth_date, photo_url),
        from_club:lg_clubs!from_club_id(id, name),
        to_club:lg_clubs!to_club_id(id, name)
      `)
      .or(`from_club_id.eq.${clubId},to_club_id.eq.${clubId}`)
      .order('created_at', { ascending: false });

    if (error) {
      return createSkillResult({ success: false, errorCode: 'LIST_TRANSFERS_FAILED', errorMessage: error.message });
    }

    const outgoing = data.filter(t => t.from_club_id === clubId);
    const incoming = data.filter(t => t.to_club_id   === clubId);

    return createSkillResult({ success: true, data: { outgoing, incoming } });
  }

  async _createTransfer({ clubId, orgId, playerId, toClubId, notes }, db) {
    if (!playerId || !toClubId) {
      return createSkillResult({ success: false, errorCode: 'MISSING_FIELDS', errorMessage: 'player_id y to_club_id son requeridos' });
    }

    if (toClubId === clubId) {
      return createSkillResult({ success: false, errorCode: 'SAME_CLUB', errorMessage: 'El club destino debe ser distinto al club origen' });
    }

    // Verificar que el jugador esté activo en el club origen
    const { data: roster, error: rosterError } = await db
      .from('lg_club_rosters')
      .select('id, status')
      .eq('club_id', clubId)
      .eq('player_id', playerId)
      .eq('status', 'ACTIVE')
      .single();

    if (rosterError || !roster) {
      return createSkillResult({ success: false, errorCode: 'PLAYER_NOT_IN_CLUB', errorMessage: 'El jugador no está activo en este club' });
    }

    // Verificar que no haya un traspaso pendiente
    const { data: pending } = await db
      .from('lg_transfers')
      .select('id')
      .eq('player_id', playerId)
      .eq('status', 'ENVIADO')
      .maybeSingle();

    if (pending) {
      return createSkillResult({ success: false, errorCode: 'TRANSFER_PENDING', errorMessage: 'El jugador ya tiene un traspaso pendiente' });
    }

    const { data: transfer, error } = await db
      .from('lg_transfers')
      .insert({
        org_id:       orgId,
        player_id:    playerId,
        from_club_id: clubId,
        to_club_id:   toClubId,
        status:       'ENVIADO',
        notes:        notes ?? null,
      })
      .select(`
        *,
        player:lg_players(id, first_name, last_name, rut),
        from_club:lg_clubs!from_club_id(id, name),
        to_club:lg_clubs!to_club_id(id, name)
      `)
      .single();

    if (error) {
      return createSkillResult({ success: false, errorCode: 'CREATE_TRANSFER_FAILED', errorMessage: error.message });
    }

    return createSkillResult({ success: true, data: { transfer } });
  }

  async _acceptTransfer({ clubId, transferId }, db) {
    // Cargar el traspaso (solo club destino puede aceptar)
    const { data: transfer, error: fetchError } = await db
      .from('lg_transfers')
      .select('*')
      .eq('id', transferId)
      .eq('to_club_id', clubId)
      .eq('status', 'ENVIADO')
      .single();

    if (fetchError || !transfer) {
      return createSkillResult({ success: false, errorCode: 'TRANSFER_NOT_FOUND', errorMessage: 'Traspaso no encontrado o no está pendiente' });
    }

    // Verificar folio disponible en destino ANTES de modificar nada
    const folioResult = await this._getAvailableFolio(transfer.to_club_id, db);
    if (folioResult.error) {
      return createSkillResult({ success: false, errorCode: folioResult.error.code, errorMessage: folioResult.error.message });
    }
    const { assignedFolio } = folioResult;

    // 1. Desactivar roster en club origen (folio queda libre)
    const { error: deactivateError } = await db
      .from('lg_club_rosters')
      .update({ status: 'INACTIVE', valid_to: new Date().toISOString() })
      .eq('player_id', transfer.player_id)
      .eq('club_id', transfer.from_club_id)
      .eq('status', 'ACTIVE');

    if (deactivateError) {
      return createSkillResult({ success: false, errorCode: 'DEACTIVATE_ROSTER_FAILED', errorMessage: deactivateError.message });
    }

    // 2. Crear roster activo en club destino con folio asignado
    const { error: rosterError } = await db
      .from('lg_club_rosters')
      .insert({
        club_id:    transfer.to_club_id,
        player_id:  transfer.player_id,
        status:     'ACTIVE',
        valid_from: new Date().toISOString(),
        club_folio: assignedFolio,
      });

    if (rosterError) {
      // Revertir desactivación
      await db
        .from('lg_club_rosters')
        .update({ status: 'ACTIVE', valid_to: null })
        .eq('player_id', transfer.player_id)
        .eq('club_id', transfer.from_club_id);

      return createSkillResult({ success: false, errorCode: 'CREATE_ROSTER_FAILED', errorMessage: rosterError.message });
    }

    // 3. Actualizar club_folio y club_id en lg_players
    await db
      .from('lg_players')
      .update({ club_id: transfer.to_club_id, club_folio: assignedFolio })
      .eq('id', transfer.player_id);

    // 4. Marcar traspaso como ACEPTADO
    const { data: updated, error: updateError } = await db
      .from('lg_transfers')
      .update({ status: 'ACEPTADO', updated_at: new Date().toISOString() })
      .eq('id', transferId)
      .select()
      .single();

    if (updateError) {
      return createSkillResult({ success: false, errorCode: 'UPDATE_TRANSFER_FAILED', errorMessage: updateError.message });
    }

    return createSkillResult({ success: true, data: { transfer: updated, assignedFolio } });
  }

  async _rejectTransfer({ clubId, transferId }, db) {
    const { data: updated, error } = await db
      .from('lg_transfers')
      .update({ status: 'RECHAZADO', updated_at: new Date().toISOString() })
      .eq('id', transferId)
      .eq('to_club_id', clubId)
      .eq('status', 'ENVIADO')
      .select()
      .single();

    if (error || !updated) {
      return createSkillResult({ success: false, errorCode: 'TRANSFER_NOT_FOUND', errorMessage: 'Traspaso no encontrado o no está pendiente' });
    }

    return createSkillResult({ success: true, data: { transfer: updated } });
  }

  async _cancelTransfer({ clubId, transferId }, db) {
    const { error } = await db
      .from('lg_transfers')
      .delete()
      .eq('id', transferId)
      .eq('from_club_id', clubId)
      .eq('status', 'ENVIADO');

    if (error) {
      return createSkillResult({ success: false, errorCode: 'CANCEL_TRANSFER_FAILED', errorMessage: error.message });
    }

    return createSkillResult({ success: true, data: { deleted: true, transferId } });
  }
}
