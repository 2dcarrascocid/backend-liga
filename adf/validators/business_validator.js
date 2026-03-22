/**
 * ADF - Business Validator (Validators Layer)
 *
 * Valida reglas de negocio que requieren consultar la base de datos.
 * Se ejecuta después de request_validator y antes del Specialist.
 *
 * DO:
 *   - Usar reglas declarativas por nombre (BusinessRules.*)
 *   - Retornar reason detallado para logs internos
 *   - Agregar nuevas reglas de negocio aquí, nunca en los Specialists
 *
 * DON'T:
 *   - Modificar datos — solo consultar y validar
 *   - Lanzar excepciones — retornar { valid: false, reason }
 *   - Duplicar validaciones que ya hace request_validator
 *
 * Checklist:
 *   [ ] ¿La regla consulta el estado actual de DB, no cache?
 *   [ ] ¿Se retorna reason claro para debugging interno?
 *   [ ] ¿La regla es idempotente (no modifica nada)?
 *   [ ] ¿Se cubre el caso de registro no encontrado?
 */

import { Skill } from '../contracts/skill_contract.js';
import { createSkillResult } from '../contracts/task_schema.js';

export const BusinessRules = Object.freeze({
  MAX_ROSTER_SIZE: 'MAX_ROSTER_SIZE',
  PLAYER_NOT_ACTIVE_IN_OTHER_CLUB: 'PLAYER_NOT_ACTIVE_IN_OTHER_CLUB',
  NATIONAL_ID_UNIQUE_IN_ORG: 'NATIONAL_ID_UNIQUE_IN_ORG',
  USER_IS_ORG_ADMIN: 'USER_IS_ORG_ADMIN',
  USER_IS_CLUB_MEMBER: 'USER_IS_CLUB_MEMBER',
  LOAN_STATUS_ALLOWS_TRANSITION: 'LOAN_STATUS_ALLOWS_TRANSITION',
  PLAYER_EXISTS_IN_ORG: 'PLAYER_EXISTS_IN_ORG',
  CLUB_EXISTS_IN_ORG: 'CLUB_EXISTS_IN_ORG',
  LOAN_TO_CLUB_IS_DIFFERENT: 'LOAN_TO_CLUB_IS_DIFFERENT',
});

const MAX_ROSTER_SIZE = 70;

const VALID_LOAN_TRANSITIONS = {
  PENDING: ['APPROVED', 'REJECTED'],
  APPROVED: ['RETURNED'],
  REJECTED: [],
  RETURNED: [],
};

export class BusinessValidator extends Skill {
  constructor() {
    super('business_validator', '1.0.0');
    this.domain = 'validators';

    this.contract = {
      input: [
        { name: 'rule', required: true, type: 'string', description: 'BusinessRules.* a evaluar' },
        { name: 'context', required: true, type: 'object', description: 'Datos necesarios para evaluar la regla' },
        { name: 'db', required: true, type: 'object', description: 'Cliente Supabase con permisos de admin' },
      ],
      output: [
        { name: 'valid', type: 'boolean', description: 'true si la regla se cumple' },
        { name: 'reason', type: 'string', description: 'Motivo del fallo (para logs internos)' },
      ],
      rules: {
        do: [
          'Evaluar siempre el estado actual de DB — nunca asumir',
          'Usar context para pasar los IDs necesarios',
          'Retornar reason descriptivo para facilitar debugging',
        ],
        dont: [
          'No modificar datos en DB',
          'No cachear resultados entre requests',
          'No evaluar múltiples reglas en un solo execute() — llamar una por una',
        ],
      },
      checklist: [
        'La consulta de DB usa el campo correcto como filtro',
        'Se maneja el caso de resultado vacío o nulo',
        'El reason es descriptivo y útil para debugging',
        'La validación es idempotente',
      ],
    };
  }

  async execute(task) {
    const { rule, context, db } = task.input;

    try {
      const result = await this._evaluate(rule, context, db);
      return createSkillResult({
        success: result.valid,
        data: result,
        errorCode: result.valid ? null : 'BUSINESS_RULE_FAILED',
        errorMessage: result.valid ? null : result.reason,
      });
    } catch (err) {
      return createSkillResult({
        success: false,
        data: { valid: false, reason: err.message },
        errorCode: 'BUSINESS_VALIDATOR_ERROR',
        errorMessage: err.message,
      });
    }
  }

  async _evaluate(rule, context, db) {
    switch (rule) {
      case BusinessRules.MAX_ROSTER_SIZE: {
        const { clubId } = context;
        const { count, error } = await db
          .from('lg_club_rosters')
          .select('id', { count: 'exact', head: true })
          .eq('club_id', clubId)
          .eq('status', 'ACTIVE');

        if (error) throw new Error(`DB error checking roster size: ${error.message}`);
        if (count >= MAX_ROSTER_SIZE) {
          return { valid: false, reason: `Club ${clubId} ya tiene ${count}/${MAX_ROSTER_SIZE} jugadores activos` };
        }
        return { valid: true, reason: null };
      }

      case BusinessRules.PLAYER_NOT_ACTIVE_IN_OTHER_CLUB: {
        const { playerId, currentClubId } = context;
        const query = db
          .from('lg_club_rosters')
          .select('club_id')
          .eq('player_id', playerId)
          .eq('status', 'ACTIVE');

        if (currentClubId) query.neq('club_id', currentClubId);

        const { data, error } = await query.maybeSingle();
        if (error) throw new Error(`DB error checking player club: ${error.message}`);
        if (data) {
          return { valid: false, reason: `Jugador ${playerId} ya está activo en club ${data.club_id}` };
        }
        return { valid: true, reason: null };
      }

      case BusinessRules.NATIONAL_ID_UNIQUE_IN_ORG: {
        const { nationalId, orgId, excludePlayerId } = context;
        let query = db
          .from('lg_players')
          .select('id')
          .eq('org_id', orgId)
          .eq('national_id', nationalId);

        if (excludePlayerId) query = query.neq('id', excludePlayerId);

        const { data, error } = await query.maybeSingle();
        if (error) throw new Error(`DB error checking national_id: ${error.message}`);
        if (data) {
          return { valid: false, reason: `national_id "${nationalId}" ya existe en la organización` };
        }
        return { valid: true, reason: null };
      }

      case BusinessRules.USER_IS_ORG_ADMIN: {
        const { userId, orgId } = context;
        const { data, error } = await db
          .from('lg_org_users')
          .select('role')
          .eq('user_id', userId)
          .eq('org_id', orgId)
          .maybeSingle();

        if (error) throw new Error(`DB error checking org admin: ${error.message}`);
        if (!data || data.role !== 'ADMIN') {
          return { valid: false, reason: `Usuario ${userId} no es ADMIN de la org ${orgId}` };
        }
        return { valid: true, reason: null };
      }

      case BusinessRules.USER_IS_CLUB_MEMBER: {
        const { userId, clubId } = context;
        const { data, error } = await db
          .from('lg_club_users')
          .select('id')
          .eq('user_id', userId)
          .eq('club_id', clubId)
          .maybeSingle();

        if (error) throw new Error(`DB error checking club member: ${error.message}`);
        if (!data) {
          return { valid: false, reason: `Usuario ${userId} no es miembro del club ${clubId}` };
        }
        return { valid: true, reason: null };
      }

      case BusinessRules.LOAN_STATUS_ALLOWS_TRANSITION: {
        const { loanId, targetStatus } = context;
        const { data, error } = await db
          .from('lg_player_loans')
          .select('status')
          .eq('id', loanId)
          .single();

        if (error || !data) throw new Error(`Préstamo ${loanId} no encontrado`);
        const allowed = VALID_LOAN_TRANSITIONS[data.status] || [];
        if (!allowed.includes(targetStatus)) {
          return {
            valid: false,
            reason: `Transición inválida: ${data.status} → ${targetStatus}. Permitidas: ${allowed.join(', ') || 'ninguna'}`,
          };
        }
        return { valid: true, reason: null };
      }

      case BusinessRules.PLAYER_EXISTS_IN_ORG: {
        const { playerId, orgId } = context;
        const { data, error } = await db
          .from('lg_players')
          .select('id')
          .eq('id', playerId)
          .eq('org_id', orgId)
          .maybeSingle();

        if (error) throw new Error(`DB error checking player: ${error.message}`);
        if (!data) return { valid: false, reason: `Jugador ${playerId} no encontrado en org ${orgId}` };
        return { valid: true, reason: null };
      }

      case BusinessRules.CLUB_EXISTS_IN_ORG: {
        const { clubId, orgId } = context;
        const { data, error } = await db
          .from('lg_clubs')
          .select('id')
          .eq('id', clubId)
          .eq('org_id', orgId)
          .maybeSingle();

        if (error) throw new Error(`DB error checking club: ${error.message}`);
        if (!data) return { valid: false, reason: `Club ${clubId} no encontrado en org ${orgId}` };
        return { valid: true, reason: null };
      }

      case BusinessRules.LOAN_TO_CLUB_IS_DIFFERENT: {
        const { fromClubId, toClubId } = context;
        if (fromClubId === toClubId) {
          return { valid: false, reason: 'El club destino debe ser diferente al club origen' };
        }
        return { valid: true, reason: null };
      }

      default:
        throw new Error(`Regla de negocio desconocida: "${rule}"`);
    }
  }
}
