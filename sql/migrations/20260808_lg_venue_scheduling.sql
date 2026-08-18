-- ============================================================
-- Migration: lg_venue_scheduling
-- Descripción: Agenda de canchas: disponibilidad semanal base
--              (lg_venue_availability) y reservas concretas por
--              fecha/hora (lg_venue_bookings), ambas ligadas a
--              lg_venues.
--
--              lg_venue_bookings.partido_id es un uuid suelto,
--              SIN foreign key: en este repo todavía no existe
--              una tabla de partidos (ver adf/specialists/
--              venues_specialist.js, que dice explícitamente que
--              la programación de partidos es "de otro dominio").
--              Cuando exista esa tabla, se puede agregar el FK
--              en una migración aparte sin romper esta.
--
--              Autorización: igual que lg_venues/lg_referees, las
--              políticas RLS son permisivas porque el backend
--              accede con service_role y valida JWT + rol
--              (lg_org_users.role = 'ADMIN') en JS antes de
--              escribir. Ese chequeo de rol admin se implementa
--              en el paso de backend, no aquí.
-- Fecha: 2026-08-08
-- Backward compatible: YES (tablas nuevas, no toca lg_venues)
-- Seguro de re-ejecutar (idempotente).
-- ============================================================

-- ── UP: Aplicar migración ────────────────────────────────────

-- Requerido por el EXCLUDE constraint de más abajo (permite usar
-- '=' sobre uuid dentro de un índice GiST).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ────────────────────────────────────────────────────────────
-- lg_venue_availability (disponibilidad_base)
-- Franjas horarias en que una cancha está disponible por día de
-- la semana. Admite varias franjas por día (ej. mañana y tarde).
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lg_venue_availability (
  id             uuid    NOT NULL DEFAULT gen_random_uuid(),
  venue_id       uuid    NOT NULL,
  dia_semana     smallint NOT NULL,
  hora_apertura  time    NOT NULL,
  hora_cierre    time    NOT NULL,
  created_at     timestamp with time zone NOT NULL DEFAULT now(),
  updated_at     timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT lg_venue_availability_pkey PRIMARY KEY (id),
  CONSTRAINT lg_venue_availability_venue_id_fkey
    FOREIGN KEY (venue_id) REFERENCES lg_venues (id) ON DELETE CASCADE
);

ALTER TABLE lg_venue_availability DROP CONSTRAINT IF EXISTS lg_venue_availability_dia_semana_check;
ALTER TABLE lg_venue_availability ADD CONSTRAINT lg_venue_availability_dia_semana_check
  CHECK (dia_semana BETWEEN 0 AND 6); -- 0 = domingo ... 6 = sábado

ALTER TABLE lg_venue_availability DROP CONSTRAINT IF EXISTS lg_venue_availability_horario_check;
ALTER TABLE lg_venue_availability ADD CONSTRAINT lg_venue_availability_horario_check
  CHECK (hora_apertura < hora_cierre);

CREATE INDEX IF NOT EXISTS idx_venue_availability_venue_id
  ON lg_venue_availability(venue_id);

-- ────────────────────────────────────────────────────────────
-- lg_venue_bookings (agenda_canchas)
-- Reservas concretas de una cancha en una fecha y rango horario.
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lg_venue_bookings (
  id           uuid    NOT NULL DEFAULT gen_random_uuid(),
  venue_id     uuid    NOT NULL,
  fecha        date    NOT NULL,
  hora_inicio  time    NOT NULL,
  hora_fin     time    NOT NULL,
  partido_id   uuid    NULL, -- sin FK: tabla de partidos no existe todavía (ver comentario de cabecera)
  created_at   timestamp with time zone NOT NULL DEFAULT now(),
  updated_at   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT lg_venue_bookings_pkey PRIMARY KEY (id),
  CONSTRAINT lg_venue_bookings_venue_id_fkey
    FOREIGN KEY (venue_id) REFERENCES lg_venues (id) ON DELETE CASCADE
);

ALTER TABLE lg_venue_bookings DROP CONSTRAINT IF EXISTS lg_venue_bookings_horario_check;
ALTER TABLE lg_venue_bookings ADD CONSTRAINT lg_venue_bookings_horario_check
  CHECK (hora_inicio < hora_fin);

-- Guardrail real contra solapamientos: constraint EXCLUDE a nivel
-- de base de datos, a prueba de inserts concurrentes (la función
-- fn_venue_booking_overlaps de más abajo NO alcanza para esto por
-- sí sola, porque dos transacciones podrían pasar la validación
-- en JS al mismo tiempo y luego insertar ambas).
ALTER TABLE lg_venue_bookings DROP CONSTRAINT IF EXISTS lg_venue_bookings_no_overlap;
ALTER TABLE lg_venue_bookings ADD CONSTRAINT lg_venue_bookings_no_overlap
  EXCLUDE USING gist (
    venue_id WITH =,
    fecha WITH =,
    tsrange(
      (fecha + hora_inicio)::timestamp,
      (fecha + hora_fin)::timestamp,
      '[)'
    ) WITH &&
  );

CREATE INDEX IF NOT EXISTS idx_venue_bookings_venue_id
  ON lg_venue_bookings(venue_id);

CREATE INDEX IF NOT EXISTS idx_venue_bookings_venue_id_fecha
  ON lg_venue_bookings(venue_id, fecha);

-- ────────────────────────────────────────────────────────────
-- fn_venue_booking_overlaps
-- Uso: el backend la llama ANTES de intentar el insert/update,
-- para devolver un 409 amigable con el detalle del choque en vez
-- de dejar que el backend reciba el error crudo del EXCLUDE
-- constraint. p_exclude_booking_id se usa al editar una reserva
-- existente, para no chocar contra sí misma.
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_venue_booking_overlaps(
  p_venue_id           uuid,
  p_fecha              date,
  p_hora_inicio        time,
  p_hora_fin           time,
  p_exclude_booking_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM lg_venue_bookings b
    WHERE b.venue_id = p_venue_id
      AND b.fecha    = p_fecha
      AND (p_exclude_booking_id IS NULL OR b.id <> p_exclude_booking_id)
      AND tsrange(
            (b.fecha + b.hora_inicio)::timestamp,
            (b.fecha + b.hora_fin)::timestamp,
            '[)'
          )
          &&
          tsrange(
            (p_fecha + p_hora_inicio)::timestamp,
            (p_fecha + p_hora_fin)::timestamp,
            '[)'
          )
  );
$$;

GRANT EXECUTE ON FUNCTION public.fn_venue_booking_overlaps(uuid, date, time, time, uuid) TO anon, authenticated;

-- ============================================================
-- RLS
-- Mismo patrón que lg_venues / lg_referees: todos los accesos
-- van por el backend con service_role, que bypasea RLS. Se
-- habilita igual para proteger accesos directos. El chequeo de
-- "solo ADMIN escribe" se hace en JS en el backend (Paso 2),
-- no en estas políticas.
-- ============================================================

ALTER TABLE lg_venue_availability ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "venue_availability_select" ON lg_venue_availability;
CREATE POLICY "venue_availability_select" ON lg_venue_availability FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "venue_availability_insert" ON lg_venue_availability;
CREATE POLICY "venue_availability_insert" ON lg_venue_availability FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "venue_availability_update" ON lg_venue_availability;
CREATE POLICY "venue_availability_update" ON lg_venue_availability FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "venue_availability_delete" ON lg_venue_availability;
CREATE POLICY "venue_availability_delete" ON lg_venue_availability FOR DELETE TO authenticated USING (true);

ALTER TABLE lg_venue_bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "venue_bookings_select" ON lg_venue_bookings;
CREATE POLICY "venue_bookings_select" ON lg_venue_bookings FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "venue_bookings_insert" ON lg_venue_bookings;
CREATE POLICY "venue_bookings_insert" ON lg_venue_bookings FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "venue_bookings_update" ON lg_venue_bookings;
CREATE POLICY "venue_bookings_update" ON lg_venue_bookings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "venue_bookings_delete" ON lg_venue_bookings;
CREATE POLICY "venue_bookings_delete" ON lg_venue_bookings FOR DELETE TO authenticated USING (true);

NOTIFY pgrst, 'reload schema';

-- ── DOWN: Revertir migración ──────────────────────────────────
-- DROP FUNCTION IF EXISTS public.fn_venue_booking_overlaps(uuid, date, time, time, uuid);
-- DROP TABLE IF EXISTS lg_venue_bookings;
-- DROP TABLE IF EXISTS lg_venue_availability;
