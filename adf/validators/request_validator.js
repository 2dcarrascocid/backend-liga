/**
 * ADF - Request Validator (Validators Layer)
 *
 * Valida los inputs de una task antes de enviárselos a un Specialist.
 * Es una Skill: recibe una task, retorna un SkillResult.
 *
 * DO:
 *   - Validar todos los campos requeridos según las reglas del plan
 *   - Reportar TODOS los errores, no solo el primero
 *   - Usar reglas declarativas (type, required, minLength, pattern)
 *
 * DON'T:
 *   - Ejecutar lógica de negocio — solo validación estructural
 *   - Acceder a la base de datos — usar business_validator para eso
 *   - Lanzar excepciones — retornar { valid: false, errors }
 *
 * Checklist:
 *   [ ] ¿Se verificaron todos los campos required?
 *   [ ] ¿Se verificaron los tipos de datos?
 *   [ ] ¿Se verificaron longitudes mínimas y máximas?
 *   [ ] ¿Se verificaron formatos (email, UUID, fecha)?
 *   [ ] ¿Se retornaron todos los errores encontrados, no solo el primero?
 */

import { Skill } from '../contracts/skill_contract.js';
import { createSkillResult } from '../contracts/task_schema.js';

const FORMAT_PATTERNS = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  date: /^\d{4}-\d{2}-\d{2}$/,
  nationalId: /^[A-Z0-9\-\.]{5,20}$/i,
  slug: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
};

/**
 * Valida un campo contra una regla.
 * @param {string} fieldName
 * @param {any}    value
 * @param {Object} rule
 * @returns {string|null} mensaje de error o null si es válido
 */
function validateField(fieldName, value, rule) {
  const isEmpty = value === undefined || value === null || value === '';

  if (rule.required && isEmpty) {
    return `"${fieldName}" es requerido`;
  }

  if (isEmpty) return null; // campo opcional y vacío → OK

  if (rule.type) {
    if (rule.type === 'array' && !Array.isArray(value)) {
      return `"${fieldName}" debe ser un array`;
    } else if (rule.type !== 'array' && typeof value !== rule.type) {
      return `"${fieldName}" debe ser de tipo ${rule.type}`;
    }
  }

  if (rule.minLength !== undefined && typeof value === 'string' && value.length < rule.minLength) {
    return `"${fieldName}" debe tener al menos ${rule.minLength} caracteres`;
  }

  if (rule.maxLength !== undefined && typeof value === 'string' && value.length > rule.maxLength) {
    return `"${fieldName}" no puede superar ${rule.maxLength} caracteres`;
  }

  if (rule.min !== undefined && typeof value === 'number' && value < rule.min) {
    return `"${fieldName}" debe ser mayor o igual a ${rule.min}`;
  }

  if (rule.max !== undefined && typeof value === 'number' && value > rule.max) {
    return `"${fieldName}" debe ser menor o igual a ${rule.max}`;
  }

  if (rule.format && FORMAT_PATTERNS[rule.format]) {
    if (!FORMAT_PATTERNS[rule.format].test(value)) {
      return `"${fieldName}" no tiene un formato ${rule.format} válido`;
    }
  }

  if (rule.enum && !rule.enum.includes(value)) {
    return `"${fieldName}" debe ser uno de: ${rule.enum.join(', ')}`;
  }

  if (rule.pattern && !rule.pattern.test(value)) {
    return rule.patternMessage || `"${fieldName}" tiene un formato inválido`;
  }

  return null;
}

export class RequestValidator extends Skill {
  constructor() {
    super('request_validator', '1.0.0');
    this.domain = 'validators';

    this.contract = {
      input: [
        { name: 'fields', required: true, type: 'object', description: 'Datos a validar' },
        { name: 'rules', required: true, type: 'array', description: 'Reglas de validación' },
      ],
      output: [
        { name: 'valid', type: 'boolean', description: 'true si todos los campos son válidos' },
        { name: 'errors', type: 'array', description: 'Lista de errores encontrados' },
      ],
      rules: {
        do: [
          'Reportar todos los errores de validación, no solo el primero',
          'Retornar valid:false cuando hay errores, nunca lanzar excepciones',
        ],
        dont: [
          'No acceder a la base de datos',
          'No ejecutar lógica de negocio',
        ],
      },
      checklist: [
        'Todos los campos required fueron verificados',
        'Los tipos de datos fueron validados',
        'Los formatos (email, uuid, date) fueron verificados',
        'Se retornaron todos los errores, no solo el primero',
      ],
    };
  }

  async execute(task) {
    const { fields, rules } = task.input;
    const errors = [];

    for (const rule of rules) {
      const value = fields[rule.field];
      const error = validateField(rule.field, value, rule);
      if (error) {
        errors.push({ field: rule.field, message: error });
      }
    }

    const valid = errors.length === 0;

    return createSkillResult({
      success: valid,
      data: { valid, errors },
      errorCode: valid ? null : 'VALIDATION_FAILED',
      errorMessage: valid ? null : `${errors.length} campo(s) inválido(s)`,
      errorDetails: valid ? null : errors,
    });
  }
}

/**
 * Catálogo de reglas de validación predefinidas por dominio.
 * El Orchestrator las usa al construir el plan de ejecución.
 */
export const ValidationRules = {
  auth: {
    LOGIN_LOCAL: [
      { field: 'email', required: true, type: 'string', format: 'email' },
      { field: 'password', required: true, type: 'string', minLength: 6 },
    ],
    LOGIN_GOOGLE: [
      { field: 'idToken', required: true, type: 'string', minLength: 20 },
    ],
    LOGIN_FACEBOOK: [
      { field: 'idToken', required: true, type: 'string', minLength: 20 },
    ],
    BOOTSTRAP: [
      { field: 'orgName', required: true, type: 'string', minLength: 2, maxLength: 100 },
      { field: 'countryCode', required: true, type: 'string', minLength: 2, maxLength: 3 },
    ],
    FORGOT_PASSWORD: [
      { field: 'email', required: true, type: 'string', format: 'email' },
    ],
    RESET_PASSWORD: [
      { field: 'token',       required: true, type: 'string', minLength: 10 },
      { field: 'newPassword', required: true, type: 'string', minLength: 8 },
    ],
    INVITE_INFO: [
      { field: 'token', required: true, type: 'string', minLength: 10 },
    ],
    ACCEPT_CLUB_INVITE: [
      { field: 'token',    required: true, type: 'string', minLength: 10 },
      { field: 'password', required: true, type: 'string', minLength: 8 },
    ],
  },
  clubs: {
    CREATE_CLUB: [
      { field: 'orgId', required: true, type: 'string', format: 'uuid' },
      { field: 'name', required: true, type: 'string', minLength: 2, maxLength: 100 },
    ],
    UPDATE_CLUB: [
      { field: 'clubId', required: true, type: 'string', format: 'uuid' },
    ],
    ADD_CLUB_USER: [
      { field: 'clubId', required: true, type: 'string', format: 'uuid' },
      { field: 'userId', required: true, type: 'string', format: 'uuid' },
    ],
    INVITE_CLUB_ADMIN: [
      { field: 'clubId', required: true,  type: 'string', format: 'uuid' },
      { field: 'email',  required: true,  type: 'string', format: 'email' },
    ],
    GET_CLUB_ADMINS: [
      { field: 'clubId', required: true,  type: 'string', format: 'uuid' },
    ],
    REMOVE_CLUB_ADMIN: [
      { field: 'clubId',      required: true, type: 'string', format: 'uuid' },
      { field: 'adminUserId', required: true, type: 'string', format: 'uuid' },
    ],
  },
  players: {
    CREATE_PLAYER: [
      { field: 'clubId', required: true, type: 'string', format: 'uuid' },
      { field: 'firstName', required: true, type: 'string', minLength: 2 },
      { field: 'lastName', required: true, type: 'string', minLength: 2 },
      { field: 'nationalId', required: true, type: 'string', minLength: 5, maxLength: 20 },
    ],
    UPDATE_PLAYER: [
      { field: 'playerId', required: true, type: 'string', format: 'uuid' },
    ],
    CHANGE_CLUB: [
      { field: 'playerId', required: true, type: 'string', format: 'uuid' },
      { field: 'toClubId', required: true, type: 'string', format: 'uuid' },
    ],
    UPDATE_STATUS: [
      { field: 'playerId', required: true, type: 'string', format: 'uuid' },
      { field: 'status', required: true, type: 'string', enum: ['ACTIVE', 'INACTIVE'] },
    ],
  },
  loans: {
    REQUEST_LOAN: [
      { field: 'playerId', required: true, type: 'string', format: 'uuid' },
      { field: 'fromClubId', required: true, type: 'string', format: 'uuid' },
      { field: 'toClubId', required: true, type: 'string', format: 'uuid' },
      { field: 'loanType', required: true, type: 'string', enum: ['LOAN', 'TRANSFER'] },
    ],
    APPROVE_LOAN: [
      { field: 'loanId', required: true, type: 'string', format: 'uuid' },
    ],
    REJECT_LOAN: [
      { field: 'loanId', required: true, type: 'string', format: 'uuid' },
    ],
    RETURN_LOAN: [
      { field: 'loanId', required: true, type: 'string', format: 'uuid' },
    ],
  },
  referees: {
    CREATE_REFEREE: [
      { field: 'orgId', required: true, type: 'string', format: 'uuid' },
      { field: 'fullName', required: true, type: 'string', minLength: 2, maxLength: 150 },
    ],
    UPDATE_REFEREE: [
      { field: 'refereeId', required: true, type: 'string', format: 'uuid' },
    ],
    DELETE_REFEREE: [
      { field: 'refereeId', required: true, type: 'string', format: 'uuid' },
    ],
    GET_REFEREE: [
      { field: 'refereeId', required: true, type: 'string', format: 'uuid' },
    ],
    LIST_REFEREES: [
      { field: 'orgId', required: true, type: 'string', format: 'uuid' },
    ],
  },
  venues: {
    CREATE_VENUE: [
      { field: 'orgId', required: true, type: 'string', format: 'uuid' },
      { field: 'name', required: true, type: 'string', minLength: 2, maxLength: 150 },
    ],
    UPDATE_VENUE: [
      { field: 'venueId', required: true, type: 'string', format: 'uuid' },
    ],
    DELETE_VENUE: [
      { field: 'venueId', required: true, type: 'string', format: 'uuid' },
    ],
    GET_VENUE: [
      { field: 'venueId', required: true, type: 'string', format: 'uuid' },
    ],
    LIST_VENUES: [
      { field: 'orgId', required: true, type: 'string', format: 'uuid' },
    ],
  },
  venue_scheduling: {
    LIST_AVAILABILITY: [
      { field: 'venueId', required: true, type: 'string', format: 'uuid' },
    ],
    CREATE_AVAILABILITY: [
      { field: 'venueId', required: true, type: 'string', format: 'uuid' },
      { field: 'diaSemana', required: true, type: 'number', min: 0, max: 6 },
      { field: 'horaApertura', required: true, type: 'string' },
      { field: 'horaCierre', required: true, type: 'string' },
    ],
    DELETE_AVAILABILITY: [
      { field: 'availabilityId', required: true, type: 'string', format: 'uuid' },
    ],
    LIST_BOOKINGS: [
      { field: 'venueId', required: true, type: 'string', format: 'uuid' },
    ],
    CREATE_BOOKING: [
      { field: 'venueId', required: true, type: 'string', format: 'uuid' },
      { field: 'fecha', required: true, type: 'string', format: 'date' },
      { field: 'horaInicio', required: true, type: 'string' },
      { field: 'horaFin', required: true, type: 'string' },
    ],
    DELETE_BOOKING: [
      { field: 'bookingId', required: true, type: 'string', format: 'uuid' },
    ],
  },
  tournaments: {
    CREATE_TOURNAMENT: [
      { field: 'orgId', required: true, type: 'string', format: 'uuid' },
      { field: 'name', required: true, type: 'string', minLength: 2, maxLength: 150 },
      { field: 'format', required: true, type: 'string', enum: ['ROUND_ROBIN', 'KNOCKOUT', 'GROUPS_KNOCKOUT'] },
    ],
    UPDATE_TOURNAMENT: [
      { field: 'tournamentId', required: true, type: 'string', format: 'uuid' },
    ],
    DELETE_TOURNAMENT: [
      { field: 'tournamentId', required: true, type: 'string', format: 'uuid' },
    ],
    GET_TOURNAMENT: [
      { field: 'tournamentId', required: true, type: 'string', format: 'uuid' },
    ],
    LIST_TOURNAMENTS: [
      { field: 'orgId', required: true, type: 'string', format: 'uuid' },
    ],
    REGISTER_TEAM: [
      { field: 'tournamentId', required: true, type: 'string', format: 'uuid' },
      { field: 'seriesId', required: true, type: 'string', format: 'uuid' },
    ],
    GENERATE_FIXTURE: [
      { field: 'tournamentId', required: true, type: 'string', format: 'uuid' },
    ],
    GET_STANDINGS: [
      { field: 'tournamentId', required: true, type: 'string', format: 'uuid' },
    ],
  },
  matches: {
    GET_MATCH: [
      { field: 'matchId', required: true, type: 'string', format: 'uuid' },
    ],
    UPDATE_MATCH_RESULT: [
      { field: 'matchId', required: true, type: 'string', format: 'uuid' },
    ],
    UPDATE_MATCH_LOGISTICS: [
      { field: 'matchId', required: true, type: 'string', format: 'uuid' },
    ],
    ADD_MATCH_EVENT: [
      { field: 'matchId', required: true, type: 'string', format: 'uuid' },
      { field: 'seriesId', required: true, type: 'string', format: 'uuid' },
      { field: 'eventType', required: true, type: 'string', enum: ['GOAL', 'OWN_GOAL', 'YELLOW_CARD', 'RED_CARD', 'WARNING'] },
    ],
    LIST_MATCHES: [
      { field: 'tournamentId', required: true, type: 'string', format: 'uuid' },
    ],
  },
  tournament_costs: {
    CREATE_MATCHDAY_COST: [
      { field: 'matchdayId', required: true, type: 'string', format: 'uuid' },
      { field: 'concept', required: true, type: 'string', minLength: 2 },
    ],
    CREATE_MATCH_COST: [
      { field: 'matchId', required: true, type: 'string', format: 'uuid' },
      { field: 'concept', required: true, type: 'string', minLength: 2 },
    ],
    GET_COSTS_SUMMARY: [
      { field: 'tournamentId', required: true, type: 'string', format: 'uuid' },
    ],
  },
  club_series: {
    CREATE_SERIES: [
      { field: 'clubId', required: true, type: 'string', format: 'uuid' },
      { field: 'name', required: true, type: 'string', minLength: 1, maxLength: 150 },
      { field: 'description', required: false, type: 'string', maxLength: 500 },
      { field: 'minAge', required: false, type: 'number', min: 1, max: 100 },
      { field: 'ageRestriction', required: false, type: 'boolean' },
    ],
    UPDATE_SERIES: [
      { field: 'seriesId', required: true, type: 'string', format: 'uuid' },
      { field: 'description', required: false, type: 'string', maxLength: 500 },
      { field: 'minAge', required: false, type: 'number', min: 1, max: 100 },
      { field: 'ageRestriction', required: false, type: 'boolean' },
    ],
    DELETE_SERIES: [
      { field: 'seriesId', required: true, type: 'string', format: 'uuid' },
    ],
    GET_SERIES: [
      { field: 'seriesId', required: true, type: 'string', format: 'uuid' },
    ],
    ASSIGN_PLAYER: [
      { field: 'seriesId', required: true, type: 'string', format: 'uuid' },
      { field: 'playerId', required: true, type: 'string', format: 'uuid' },
    ],
    UNASSIGN_PLAYER: [
      { field: 'seriesId', required: true, type: 'string', format: 'uuid' },
      { field: 'playerId', required: true, type: 'string', format: 'uuid' },
    ],
    GET_SERIES_ROSTER: [
      { field: 'seriesId', required: true, type: 'string', format: 'uuid' },
    ],
  },
};
