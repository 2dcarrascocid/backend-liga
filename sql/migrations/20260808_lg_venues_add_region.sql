-- ============================================================
-- Migration: lg_venues_add_region
-- Descripción: Agrega la columna region a lg_venues para el
--              select encadenado Región → Comuna del mantenedor
--              de Canchas (comuna ya existe en la columna city).
-- Fecha: 2026-08-08
-- Backward compatible: YES (columna nueva, nullable)
-- ============================================================

-- ── UP: Aplicar migración ────────────────────────────────────

ALTER TABLE lg_venues
  ADD COLUMN IF NOT EXISTS region text NULL;

NOTIFY pgrst, 'reload schema';

-- ── DOWN: Revertir migración ──────────────────────────────────
-- ALTER TABLE lg_venues DROP COLUMN IF EXISTS region;
