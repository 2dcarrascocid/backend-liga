/**
 * ADF - Loans Specialist (Specialists Layer)
 *
 * Gestiona el ciclo de vida de préstamos y transferencias de jugadores.
 * Flujo: REQUEST → APPROVE/REJECT → RETURN (solo para LOAN)
 *
 * DO:
 *   - Validar transición de estado antes de operar
 *   - En APPROVE: actualizar lg_player_loans Y lg_club_rosters de forma coordinada
 *   - En RETURN: desactivar roster en club destino y reactivar en club origen
 *   - Registrar decisor (decided_by_user_id) en aprobaciones y rechazos
 *
 * DON'T:
 *   - No modificar el estado del préstamo sin verificar la transición válida
 *   - No ejecutar cambios de roster sin actualizar el loan simultáneamente
 *   - No lanzar excepciones no controladas
 *
 * Capabilities: REQUEST_LOAN | APPROVE_LOAN | REJECT_LOAN | RETURN_LOAN | LIST_LOANS
 *
 * Checklist:
 *   [ ] ¿Se verificó la transición de estado antes de mutaciones?
 *   [ ] ¿El roster se actualizó junto con el loan en APPROVE/RETURN?
 *   [ ] ¿Se registró decided_by_user_id en APPROVE/REJECT?
 *   [ ] ¿Existe lógica de rollback ante fallo parcial?
 */

import { Skill } from '../contracts/skill_contract.js';
import { createSkillResult } from '../contracts/task_schema.js';

const CAPABILITIES = ['REQUEST_LOAN', 'APPROVE_LOAN', 'REJECT_LOAN', 'RETURN_LOAN', 'LIST_LOANS'];

const VALID_TRANSITIONS = {
  PENDING: ['APPROVED', 'REJECTED'],
  APPROVED: ['RETURNED'],
  REJECTED: [],
  RETURNED: [],
};

export class LoansSpecialist extends Skill {
  constructor() {
    super('loans_specialist', '1.0.0');
    this.domain = 'loans';
    this.capabilities = CAPABILITIES;

    this.contract = {
      input: [
        { name: 'operation', required: true, type: 'string' },
        { name: 'payload', required: true, type: 'object' },
        { name: 'db', required: true, type: 'object' },
        { name: 'userId', required: false, type: 'string' },
      ],
      output: [
        { name: 'loan', type: 'object' },
        { name: 'loans', type: 'array' },
      ],
      rules: {
        do: [
          'Verificar transición de estado antes de cada mutación',
          'Actualizar roster y loan de forma coordinada en APPROVE/RETURN',
          'Registrar userId del decisor en APPROVE/REJECT',
        ],
        dont: [
          'No aprobar/rechazar sin verificar transición válida',
          'No actualizar solo el loan sin actualizar el roster',
        ],
      },
      checklist: [
        'Transición de estado verificada',
        'Roster actualizado junto con el loan',
        'decided_by_user_id registrado',
        'Rollback disponible ante fallos parciales',
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
        case 'REQUEST_LOAN': return this._requestLoan(payload, db, userId);
        case 'APPROVE_LOAN': return this._approveLoan(payload, db, userId);
        case 'REJECT_LOAN':  return this._rejectLoan(payload, db, userId);
        case 'RETURN_LOAN':  return this._returnLoan(payload, db, userId);
        case 'LIST_LOANS':   return this._listLoans(payload, db);
      }
    } catch (err) {
      return createSkillResult({
        success: false,
        errorCode: 'LOANS_SPECIALIST_ERROR',
        errorMessage: err.message,
      });
    }
  }

  async _requestLoan({ orgId, playerId, fromClubId, toClubId, loanType, startDate, endDate }, db, userId) {
    // Verify player is active in fromClub
    const { data: activeRoster } = await db
      .from('lg_club_rosters')
      .select('id')
      .eq('player_id', playerId)
      .eq('club_id', fromClubId)
      .eq('status', 'ACTIVE')
      .maybeSingle();

    if (!activeRoster) {
      return createSkillResult({
        success: false,
        errorCode: 'PLAYER_NOT_ACTIVE_IN_CLUB',
        errorMessage: 'El jugador no está activo en el club origen',
      });
    }

    const { data: loan, error } = await db
      .from('lg_player_loans')
      .insert({
        org_id: orgId,
        player_id: playerId,
        from_club_id: fromClubId,
        to_club_id: toClubId,
        loan_type: loanType,
        status: 'PENDING',
        start_date: startDate,
        end_date: endDate,
        requested_by_user_id: userId,
      })
      .select()
      .single();

    if (error) return createSkillResult({ success: false, errorCode: 'REQUEST_LOAN_FAILED', errorMessage: error.message });

    return createSkillResult({ success: true, data: { loan } });
  }

  async _approveLoan({ loanId }, db, userId) {
    const loan = await this._getLoanOrFail(loanId, db);
    if (!loan.data) return loan; // error already in createSkillResult format

    if (!VALID_TRANSITIONS[loan.data.status]?.includes('APPROVED')) {
      return createSkillResult({
        success: false,
        errorCode: 'INVALID_TRANSITION',
        errorMessage: `No se puede aprobar un préstamo en estado ${loan.data.status}`,
      });
    }

    const { playerId, fromClubId, toClubId } = {
      playerId: loan.data.player_id,
      fromClubId: loan.data.from_club_id,
      toClubId: loan.data.to_club_id,
    };

    // Deactivate in from_club
    const { error: deactivateErr } = await db
      .from('lg_club_rosters')
      .update({ status: 'INACTIVE', valid_to: new Date().toISOString() })
      .eq('player_id', playerId)
      .eq('club_id', fromClubId)
      .eq('status', 'ACTIVE');

    if (deactivateErr) {
      return createSkillResult({ success: false, errorCode: 'DEACTIVATE_ROSTER_FAILED', errorMessage: deactivateErr.message });
    }

    // Activate in to_club
    const { error: activateErr } = await db
      .from('lg_club_rosters')
      .insert({ club_id: toClubId, player_id: playerId, status: 'ACTIVE' });

    if (activateErr) {
      // Attempt rollback
      await db.from('lg_club_rosters').update({ status: 'ACTIVE', valid_to: null })
        .eq('player_id', playerId).eq('club_id', fromClubId);
      return createSkillResult({ success: false, errorCode: 'ACTIVATE_ROSTER_FAILED', errorMessage: activateErr.message });
    }

    // Update loan status
    const { data: updatedLoan, error: loanErr } = await db
      .from('lg_player_loans')
      .update({ status: 'APPROVED', decided_by_user_id: userId })
      .eq('id', loanId)
      .select()
      .single();

    if (loanErr) return createSkillResult({ success: false, errorCode: 'UPDATE_LOAN_FAILED', errorMessage: loanErr.message });

    return createSkillResult({ success: true, data: { loan: updatedLoan } });
  }

  async _rejectLoan({ loanId, reason }, db, userId) {
    const loanResult = await this._getLoanOrFail(loanId, db);
    if (!loanResult.data) return loanResult;

    if (!VALID_TRANSITIONS[loanResult.data.status]?.includes('REJECTED')) {
      return createSkillResult({
        success: false,
        errorCode: 'INVALID_TRANSITION',
        errorMessage: `No se puede rechazar un préstamo en estado ${loanResult.data.status}`,
      });
    }

    const { data: loan, error } = await db
      .from('lg_player_loans')
      .update({ status: 'REJECTED', decided_by_user_id: userId })
      .eq('id', loanId)
      .select()
      .single();

    if (error) return createSkillResult({ success: false, errorCode: 'REJECT_LOAN_FAILED', errorMessage: error.message });

    return createSkillResult({ success: true, data: { loan } });
  }

  async _returnLoan({ loanId }, db, userId) {
    const loanResult = await this._getLoanOrFail(loanId, db);
    if (!loanResult.data) return loanResult;

    const currentLoan = loanResult.data;
    if (!VALID_TRANSITIONS[currentLoan.status]?.includes('RETURNED')) {
      return createSkillResult({
        success: false,
        errorCode: 'INVALID_TRANSITION',
        errorMessage: `No se puede retornar un préstamo en estado ${currentLoan.status}`,
      });
    }

    const { player_id: playerId, from_club_id: fromClubId, to_club_id: toClubId } = currentLoan;

    // Deactivate in to_club
    await db.from('lg_club_rosters')
      .update({ status: 'INACTIVE', valid_to: new Date().toISOString() })
      .eq('player_id', playerId)
      .eq('club_id', toClubId)
      .eq('status', 'ACTIVE');

    // Reactivate in from_club
    await db.from('lg_club_rosters')
      .insert({ club_id: fromClubId, player_id: playerId, status: 'ACTIVE' });

    const { data: loan, error } = await db
      .from('lg_player_loans')
      .update({ status: 'RETURNED', decided_by_user_id: userId })
      .eq('id', loanId)
      .select()
      .single();

    if (error) return createSkillResult({ success: false, errorCode: 'RETURN_LOAN_FAILED', errorMessage: error.message });

    return createSkillResult({ success: true, data: { loan } });
  }

  async _listLoans({ orgId, status, playerId, limit = 20 }, db) {
    let query = db
      .from('lg_player_loans')
      .select('*, lg_players(first_name, last_name, national_id), from_club:lg_clubs!from_club_id(name), to_club:lg_clubs!to_club_id(name)')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (orgId) query = query.eq('org_id', orgId);
    if (status) query = query.eq('status', status);
    if (playerId) query = query.eq('player_id', playerId);

    const { data: loans, error } = await query;
    if (error) return createSkillResult({ success: false, errorCode: 'LIST_LOANS_FAILED', errorMessage: error.message });

    return createSkillResult({ success: true, data: { loans } });
  }

  async _getLoanOrFail(loanId, db) {
    const { data, error } = await db.from('lg_player_loans').select('*').eq('id', loanId).single();
    if (error || !data) {
      return createSkillResult({ success: false, errorCode: 'LOAN_NOT_FOUND', errorMessage: `Préstamo ${loanId} no encontrado` });
    }
    return { data, success: true };
  }
}
