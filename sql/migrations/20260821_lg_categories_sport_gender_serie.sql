-- ============================================================
-- Migration: lg_categories_sport_gender_serie
-- Descripción: Nuevo mantenedor de Categorías (Parámetros → Categorías),
--              usadas para clasificar Torneos (lg_tournaments.category_id
--              ya apunta a esta tabla desde 20260814_lg_tournaments.sql).
--
--              lg_categories ya tenía una columna `sport_id` sin usar
--              (drift previo, nunca quedó con FK) — esta migración la
--              conecta a lg_sports (catálogo global existente: Futbol,
--              Futsal, Basquetbol, etc., sin org_id) y agrega las dos
--              columnas que faltaban: gender y serie.
--
--              age_from/age_to (ya existentes) se siguen usando para
--              "Edad mínima"/"Edad máxima" — 0 es un valor válido
--              (categorías sin piso o techo de edad), por eso el backend
--              usa `??` en vez de chequeo de truthy al guardarlas.
--
-- Nota: es idempotente. Se puede correr las veces que haga falta.
-- Fecha: 2026-08-21
-- ============================================================

ALTER TABLE lg_categories
  ADD COLUMN IF NOT EXISTS gender text,
  ADD COLUMN IF NOT EXISTS serie  text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'lg_categories_sport_id_fkey'
  ) THEN
    ALTER TABLE lg_categories
      ADD CONSTRAINT lg_categories_sport_id_fkey
      FOREIGN KEY (sport_id) REFERENCES lg_sports (id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'lg_categories_gender_check'
  ) THEN
    ALTER TABLE lg_categories
      ADD CONSTRAINT lg_categories_gender_check
      CHECK (gender IS NULL OR gender IN ('MASCULINO', 'FEMENINO', 'MIXTO'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_lg_categories_sport_id ON lg_categories(sport_id);

NOTIFY pgrst, 'reload schema';
