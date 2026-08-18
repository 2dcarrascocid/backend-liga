/**
 * ADF - Venue Scheduling Specialist (Specialists Layer)
 *
 * Ejecuta operaciones del dominio de agenda de canchas: disponibilidad
 * semanal base (lg_venue_availability) y reservas por fecha/hora
 * (lg_venue_bookings). Es el dominio al que venues_specialist.js remite
 * cuando dice "no gestionar la programación de partidos en canchas".
 *
 * DO:
 *   - Operar sobre lg_venue_availability y lg_venue_bookings
 *   - Validar solapamientos con fn_venue_booking_overlaps antes de
 *     insertar/actualizar una reserva, y traducir el error del
 *     EXCLUDE constraint (23P01) a un mensaje de negocio si igual ocurre
 *   - No lanzar excepciones no controladas
 *
 * Capabilities:
 *   LIST_AVAILABILITY | CREATE_AVAILABILITY | DELETE_AVAILABILITY |
 *   LIST_BOOKINGS | CREATE_BOOKING | DELETE_BOOKING
 */

import { Skill } from '../contracts/skill_contract.js';
import { createSkillResult } from '../contracts/task_schema.js';

const CAPABILITIES = [
  'LIST_AVAILABILITY',
  'CREATE_AVAILABILITY',
  'DELETE_AVAILABILITY',
  'LIST_BOOKINGS',
  'CREATE_BOOKING',
  'DELETE_BOOKING',
];

const EXCLUSION_VIOLATION = '23P01';

export class VenueSchedulingSpecialist extends Skill {
  constructor() {
    super('venue_scheduling_specialist', '1.0.0');
    this.domain = 'venue_scheduling';
    this.capabilities = CAPABILITIES;

    this.contract = {
      input: [
        { name: 'operation', required: true,  type: 'string' },
        { name: 'payload',   required: true,  type: 'object' },
        { name: 'db',        required: true,  type: 'object' },
        { name: 'userId',    required: false, type: 'string' },
      ],
      output: [
        { name: 'availability', type: 'array'  },
        { name: 'bookings',     type: 'array'  },
        { name: 'booking',      type: 'object' },
      ],
      rules: {
        do: [
          'Validar hora_apertura < hora_cierre y hora_inicio < hora_fin',
          'Chequear solapamientos con fn_venue_booking_overlaps antes de crear una reserva',
        ],
        dont: [
          'No gestionar el dominio de partidos desde aquí — partido_id es solo una referencia suelta',
        ],
      },
      checklist: [
        'CREATE_BOOKING valida solapamientos antes de insertar',
        'LIST_BOOKINGS filtra por venue_id y, si se entrega, por fecha',
        'DELETE_AVAILABILITY / DELETE_BOOKING verifican existencia antes de eliminar',
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
        case 'LIST_AVAILABILITY':  return this._listAvailability(payload, db);
        case 'CREATE_AVAILABILITY': return this._createAvailability(payload, db);
        case 'DELETE_AVAILABILITY': return this._deleteAvailability(payload, db);
        case 'LIST_BOOKINGS':      return this._listBookings(payload, db);
        case 'CREATE_BOOKING':     return this._createBooking(payload, db);
        case 'DELETE_BOOKING':     return this._deleteBooking(payload, db);
      }
    } catch (err) {
      return createSkillResult({
        success: false,
        errorCode: 'VENUE_SCHEDULING_SPECIALIST_ERROR',
        errorMessage: err.message,
      });
    }
  }

  // ── Disponibilidad semanal (lg_venue_availability) ─────────────────────────

  async _listAvailability({ venueId }, db) {
    const { data: availability, error } = await db
      .from('lg_venue_availability')
      .select('*')
      .eq('venue_id', venueId)
      .order('dia_semana', { ascending: true })
      .order('hora_apertura', { ascending: true });

    if (error) {
      return createSkillResult({
        success: false,
        errorCode: 'LIST_AVAILABILITY_FAILED',
        errorMessage: error.message,
      });
    }

    return createSkillResult({ success: true, data: { availability } });
  }

  async _createAvailability({ venueId, diaSemana, horaApertura, horaCierre }, db) {
    if (venueId === undefined || diaSemana === undefined || !horaApertura || !horaCierre) {
      return createSkillResult({
        success: false,
        errorCode: 'MISSING_FIELDS',
        errorMessage: 'venueId, diaSemana, horaApertura y horaCierre son requeridos',
      });
    }

    if (horaApertura >= horaCierre) {
      return createSkillResult({
        success: false,
        errorCode: 'INVALID_RANGE',
        errorMessage: 'hora_apertura debe ser menor que hora_cierre',
      });
    }

    const { data: row, error } = await db
      .from('lg_venue_availability')
      .insert({
        venue_id: venueId,
        dia_semana: diaSemana,
        hora_apertura: horaApertura,
        hora_cierre: horaCierre,
      })
      .select()
      .single();

    if (error) {
      return createSkillResult({
        success: false,
        errorCode: 'CREATE_AVAILABILITY_FAILED',
        errorMessage: error.message,
      });
    }

    return createSkillResult({ success: true, data: { availability: row } });
  }

  async _deleteAvailability({ availabilityId }, db) {
    const { data: existing, error: fetchErr } = await db
      .from('lg_venue_availability')
      .select('id')
      .eq('id', availabilityId)
      .maybeSingle();

    if (fetchErr || !existing) {
      return createSkillResult({
        success: false,
        errorCode: 'AVAILABILITY_NOT_FOUND',
        errorMessage: 'Franja de disponibilidad no encontrada',
      });
    }

    const { error } = await db
      .from('lg_venue_availability')
      .delete()
      .eq('id', availabilityId);

    if (error) {
      return createSkillResult({
        success: false,
        errorCode: 'DELETE_AVAILABILITY_FAILED',
        errorMessage: error.message,
      });
    }

    return createSkillResult({ success: true, data: { deleted: true, availabilityId } });
  }

  // ── Reservas (lg_venue_bookings) ────────────────────────────────────────────

  async _listBookings({ venueId, fecha }, db) {
    let query = db
      .from('lg_venue_bookings')
      .select('*')
      .eq('venue_id', venueId)
      .order('fecha', { ascending: true })
      .order('hora_inicio', { ascending: true });

    if (fecha) query = query.eq('fecha', fecha);

    const { data: bookings, error } = await query;

    if (error) {
      return createSkillResult({
        success: false,
        errorCode: 'LIST_BOOKINGS_FAILED',
        errorMessage: error.message,
      });
    }

    return createSkillResult({ success: true, data: { bookings } });
  }

  async _createBooking({ venueId, fecha, horaInicio, horaFin, partidoId }, db) {
    if (!venueId || !fecha || !horaInicio || !horaFin) {
      return createSkillResult({
        success: false,
        errorCode: 'MISSING_FIELDS',
        errorMessage: 'venueId, fecha, horaInicio y horaFin son requeridos',
      });
    }

    if (horaInicio >= horaFin) {
      return createSkillResult({
        success: false,
        errorCode: 'INVALID_RANGE',
        errorMessage: 'hora_inicio debe ser menor que hora_fin',
      });
    }

    const { data: overlaps, error: overlapErr } = await db.rpc('fn_venue_booking_overlaps', {
      p_venue_id: venueId,
      p_fecha: fecha,
      p_hora_inicio: horaInicio,
      p_hora_fin: horaFin,
    });

    if (overlapErr) {
      return createSkillResult({
        success: false,
        errorCode: 'OVERLAP_CHECK_FAILED',
        errorMessage: overlapErr.message,
      });
    }

    if (overlaps) {
      return createSkillResult({
        success: false,
        errorCode: 'BOOKING_OVERLAP',
        errorMessage: 'La cancha ya tiene una reserva que se cruza con ese horario',
      });
    }

    const { data: booking, error } = await db
      .from('lg_venue_bookings')
      .insert({
        venue_id: venueId,
        fecha,
        hora_inicio: horaInicio,
        hora_fin: horaFin,
        partido_id: partidoId ?? null,
      })
      .select()
      .single();

    if (error) {
      if (error.code === EXCLUSION_VIOLATION) {
        return createSkillResult({
          success: false,
          errorCode: 'BOOKING_OVERLAP',
          errorMessage: 'La cancha ya tiene una reserva que se cruza con ese horario',
        });
      }
      return createSkillResult({
        success: false,
        errorCode: 'CREATE_BOOKING_FAILED',
        errorMessage: error.message,
      });
    }

    return createSkillResult({ success: true, data: { booking } });
  }

  async _deleteBooking({ bookingId }, db) {
    const { data: existing, error: fetchErr } = await db
      .from('lg_venue_bookings')
      .select('id')
      .eq('id', bookingId)
      .maybeSingle();

    if (fetchErr || !existing) {
      return createSkillResult({
        success: false,
        errorCode: 'BOOKING_NOT_FOUND',
        errorMessage: 'Reserva no encontrada',
      });
    }

    const { error } = await db
      .from('lg_venue_bookings')
      .delete()
      .eq('id', bookingId);

    if (error) {
      return createSkillResult({
        success: false,
        errorCode: 'DELETE_BOOKING_FAILED',
        errorMessage: error.message,
      });
    }

    return createSkillResult({ success: true, data: { deleted: true, bookingId } });
  }
}
