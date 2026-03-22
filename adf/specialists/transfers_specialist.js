/**
 * ADF - Transfers Specialist (Specialists Layer)
 *
 * Ejecuta operaciones del dominio de traspasos de jugadores entre clubes.
 * Maneja el ciclo de vida completo: ENVIADO → ACEPTADO / RECHAZADO, cancelación.
 *
 * DO:
 *   - Operar sobre lg_transfers y lg_club_rosters
 *   - En ACCEPT_TRANSFER: desactivar roster origen y crear roster destino de forma secuencial
 *   - En CREATE_TRANSFER: validar que el jugador esté ACTIVE en el club origen
 *   - En CREATE_TRANSFER: verificar que no exista otro traspaso ENVIADO para el mismo jugador
 *   - Solo el club destino puede ACCEPT/REJECT; solo el club origen puede CANCEL
 *
 * DON'T:
 *   - No procesar traspasos en estado distinto de ENVIADO en accept/reject/cancel
 *   - No permitir traspaso al mismo club
 *   - No lanzar excepciones no controladas
 *
 * Capabilities:
 *   LIST_TRANSFERS | CREATE_TRANSFER | ACCEPT_TRANSFER | REJECT_TRANSFER | CANCEL_TRANSFER
 *
 * Checklist:
 *   [ ] ¿CREATE valida jugador ACTIVE en club origen?
 *   [ ] ¿CREATE verifica que no haya traspaso ENVIADO pendiente?
 *   [ ] ¿ACCEPT desactiva roster origen y crea roster destino?
 *   [ ] ¿ACCEPT/REJECT solo aplica si to_club_id coincide?
 *   [ ] ¿CANCEL solo aplica si from_club_id coincide y status = ENVIADO?
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
    super('transfers_specialist', '1.0.0');
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
        { name: 'transfer',  type: 'object' },
        { name: 'outgoing',  type: 'array'  },
        { name: 'incoming',  type: 'array'  },
      ],
      rules: {
        do: [
          'Separar traspasos en outgoing (from_club) e incoming (to_club) en LIST',
          'Validar jugador ACTIVE en club origen antes de crear traspaso',
          'Verificar traspaso pendiente antes de crear uno nuevo',
          'En ACCEPT: desactivar roster origen, crear roster destino, marcar ACEPTADO',
          'Solo club destino puede aceptar/rechazar; solo club origen puede cancelar',
        ],
        dont: [
          'No procesar traspasos que no estén en estado ENVIADO',
          'No permitir traspaso al mismo club',
        ],
      },
      checklist: [
        'CREATE valida roster ACTIVE en from_club',
        'CREATE verifica que no haya traspaso ENVIADO duplicado',
        'ACCEPT desactiva roster en from_club y crea roster en to_club',
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
      return createSkillResult({
        success: false,
        errorCode: 'LIST_TRANSFERS_FAILED',
        errorMessage: error.message,
      });
    }

    const outgoing = data.filter(t => t.from_club_id === clubId);
    const incoming = data.filter(t => t.to_club_id   === clubId);

    return createSkillResult({ success: true, data: { outgoing, incoming } });
  }

  async _createTransfer({ clubId, orgId, playerId, toClubId, notes }, db) {
    if (!playerId || !toClubId) {
      return createSkillResult({
        success: false,
        errorCode: 'MISSING_FIELDS',
        errorMessage: 'player_id y to_club_id son requeridos',
      });
    }

    if (toClubId === clubId) {
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
      .eq('club_id', clubId)
      .eq('player_id', playerId)
      .eq('status', 'ACTIVE')
      .single();

    if (rosterError || !roster) {
      return createSkillResult({
        success: false,
        errorCode: 'PLAYER_NOT_IN_CLUB',
        errorMessage: 'El jugador no está activo en este club',
      });
    }

    // Verificar que no haya un traspaso pendiente
    const { data: pending } = await db
      .from('lg_transfers')
      .select('id')
      .eq('player_id', playerId)
      .eq('status', 'ENVIADO')
      .maybeSingle();

    if (pending) {
      return createSkillResult({
        success: false,
        errorCode: 'TRANSFER_PENDING',
        errorMessage: 'El jugador ya tiene un traspaso pendiente',
      });
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
      return createSkillResult({
        success: false,
        errorCode: 'CREATE_TRANSFER_FAILED',
        errorMessage: error.message,
      });
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
      return createSkillResult({
        success: false,
        errorCode: 'TRANSFER_NOT_FOUND',
        errorMessage: 'Traspaso no encontrado o no está pendiente',
      });
    }

    // 1. Desactivar roster en club origen
    const { error: deactivateError } = await db
      .from('lg_club_rosters')
      .update({ status: 'INACTIVE', valid_to: new Date().toISOString() })
      .eq('player_id', transfer.player_id)
      .eq('club_id', transfer.from_club_id)
      .eq('status', 'ACTIVE');

    if (deactivateError) {
      return createSkillResult({
        success: false,
        errorCode: 'DEACTIVATE_ROSTER_FAILED',
        errorMessage: deactivateError.message,
      });
    }

    // 2. Crear roster activo en club destino
    const { error: rosterError } = await db
      .from('lg_club_rosters')
      .insert({
        club_id:    transfer.to_club_id,
        player_id:  transfer.player_id,
        status:     'ACTIVE',
        valid_from: new Date().toISOString(),
      });

    if (rosterError) {
      // Revertir desactivación
      await db
        .from('lg_club_rosters')
        .update({ status: 'ACTIVE', valid_to: null })
        .eq('player_id', transfer.player_id)
        .eq('club_id', transfer.from_club_id);

      return createSkillResult({
        success: false,
        errorCode: 'CREATE_ROSTER_FAILED',
        errorMessage: rosterError.message,
      });
    }

    // 3. Marcar traspaso como ACEPTADO
    const { data: updated, error: updateError } = await db
      .from('lg_transfers')
      .update({ status: 'ACEPTADO', updated_at: new Date().toISOString() })
      .eq('id', transferId)
      .select()
      .single();

    if (updateError) {
      return createSkillResult({
        success: false,
        errorCode: 'UPDATE_TRANSFER_FAILED',
        errorMessage: updateError.message,
      });
    }

    return createSkillResult({ success: true, data: { transfer: updated } });
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
      return createSkillResult({
        success: false,
        errorCode: 'TRANSFER_NOT_FOUND',
        errorMessage: 'Traspaso no encontrado o no está pendiente',
      });
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
      return createSkillResult({
        success: false,
        errorCode: 'CANCEL_TRANSFER_FAILED',
        errorMessage: error.message,
      });
    }

    return createSkillResult({ success: true, data: { deleted: true, transferId } });
  }
}
