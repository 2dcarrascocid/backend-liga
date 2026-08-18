-- ============================================================
-- Migration: lg_venues_drop_capacity_schedule
-- Descripción: Elimina de lg_venues los campos capacity,
--              start_time, end_time y duration_minutes.
--              Se sacaron del formulario/servicio de Canchas
--              a pedido del usuario. La vista "Horarios" sigue
--              leyendo estos campos en el cliente y, al dejar de
--              existir, mostrará "Sin horario configurado" para
--              todas las canchas (comportamiento aceptado).
-- Fecha: 2026-08-07
-- Backward compatible: NO — requiere que el backend ya no
--   lea/escriba estas columnas antes de aplicar esta migración
--   (venues_specialist.js y handler.js ya se actualizaron).
-- ============================================================

-- ── UP: Aplicar migración ────────────────────────────────────

ALTER TABLE lg_venues
  DROP CONSTRAINT IF EXISTS lg_venues_duration_minutes_check;

ALTER TABLE lg_venues
  DROP COLUMN IF EXISTS capacity,
  DROP COLUMN IF EXISTS start_time,
  DROP COLUMN IF EXISTS end_time,
  DROP COLUMN IF EXISTS duration_minutes;

NOTIFY pgrst, 'reload schema';

-- ── DOWN: Revertir migración ──────────────────────────────────
-- ALTER TABLE lg_venues
--   ADD COLUMN IF NOT EXISTS capacity integer NULL,
--   ADD COLUMN IF NOT EXISTS start_time time NULL,
--   ADD COLUMN IF NOT EXISTS end_time time NULL,
--   ADD COLUMN IF NOT EXISTS duration_minutes integer NOT NULL DEFAULT 60;
-- ALTER TABLE lg_venues
--   ADD CONSTRAINT lg_venues_duration_minutes_check CHECK (duration_minutes > 0);
