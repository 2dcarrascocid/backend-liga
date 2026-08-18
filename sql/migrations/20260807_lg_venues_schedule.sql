-- ============================================================
-- Migration: lg_venues_schedule
-- Descripción: Agrega horario de funcionamiento y duración de
--              turno a las canchas (lg_venues).
-- Fecha: 2026-08-07
-- Backward compatible: YES (columnas nuevas, nullable o con
--   DEFAULT; el código existente sigue funcionando sin ellas)
-- ============================================================

-- ── UP: Aplicar migración ────────────────────────────────────

ALTER TABLE lg_venues
  ADD COLUMN IF NOT EXISTS start_time        time NULL,
  ADD COLUMN IF NOT EXISTS end_time          time NULL,
  ADD COLUMN IF NOT EXISTS duration_minutes  integer NOT NULL DEFAULT 60;

ALTER TABLE lg_venues
  ADD CONSTRAINT lg_venues_duration_minutes_check CHECK (duration_minutes > 0);

NOTIFY pgrst, 'reload schema';

-- ── DOWN: Revertir migración ──────────────────────────────────
-- ALTER TABLE lg_venues DROP CONSTRAINT IF EXISTS lg_venues_duration_minutes_check;
-- ALTER TABLE lg_venues DROP COLUMN IF EXISTS start_time;
-- ALTER TABLE lg_venues DROP COLUMN IF EXISTS end_time;
-- ALTER TABLE lg_venues DROP COLUMN IF EXISTS duration_minutes;
