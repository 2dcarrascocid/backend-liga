-- ============================================================
-- Patch: lg_venues_ensure_columns
-- Descripción: Fuerza que TODAS las columnas de lg_venues existan,
--              columna por columna con ADD COLUMN IF NOT EXISTS.
--              Necesario porque ya existía una tabla lg_venues
--              previa (probablemente un stub con pocas columnas)
--              y "CREATE TABLE IF NOT EXISTS" no la completó:
--              solo agregó 'region' porque tenía su propio ALTER
--              explícito, dejando 'city' (y posiblemente otras)
--              sin crear.
-- Fecha: 2026-08-08
-- Seguro de re-ejecutar (idempotente).
-- ============================================================

ALTER TABLE lg_venues ADD COLUMN IF NOT EXISTS name          text;
ALTER TABLE lg_venues ADD COLUMN IF NOT EXISTS address       text NULL;
ALTER TABLE lg_venues ADD COLUMN IF NOT EXISTS region        text NULL;
ALTER TABLE lg_venues ADD COLUMN IF NOT EXISTS city          text NULL;
ALTER TABLE lg_venues ADD COLUMN IF NOT EXISTS surface_type  text NOT NULL DEFAULT 'NATURAL';
ALTER TABLE lg_venues ADD COLUMN IF NOT EXISTS lighting      boolean NOT NULL DEFAULT false;
ALTER TABLE lg_venues ADD COLUMN IF NOT EXISTS status        text NOT NULL DEFAULT 'DISPONIBLE';
ALTER TABLE lg_venues ADD COLUMN IF NOT EXISTS notes         text NULL;
ALTER TABLE lg_venues ADD COLUMN IF NOT EXISTS created_at    timestamp with time zone NOT NULL DEFAULT now();
ALTER TABLE lg_venues ADD COLUMN IF NOT EXISTS updated_at    timestamp with time zone NOT NULL DEFAULT now();

-- Constraints (DROP + ADD para que sea idempotente: Postgres no
-- soporta "ADD CONSTRAINT IF NOT EXISTS")
ALTER TABLE lg_venues DROP CONSTRAINT IF EXISTS lg_venues_surface_type_check;
ALTER TABLE lg_venues ADD CONSTRAINT lg_venues_surface_type_check
  CHECK (surface_type IN ('NATURAL', 'SINTETICA', 'CEMENTO', 'OTRA'));

ALTER TABLE lg_venues DROP CONSTRAINT IF EXISTS lg_venues_status_check;
ALTER TABLE lg_venues ADD CONSTRAINT lg_venues_status_check
  CHECK (status IN ('DISPONIBLE', 'MANTENIMIENTO', 'INACTIVA'));

CREATE INDEX IF NOT EXISTS idx_venues_org_id ON lg_venues(org_id);
CREATE INDEX IF NOT EXISTS idx_venues_status ON lg_venues(status);

ALTER TABLE lg_venues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "venues_select" ON lg_venues;
CREATE POLICY "venues_select" ON lg_venues FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "venues_insert" ON lg_venues;
CREATE POLICY "venues_insert" ON lg_venues FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "venues_update" ON lg_venues;
CREATE POLICY "venues_update" ON lg_venues FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "venues_delete" ON lg_venues;
CREATE POLICY "venues_delete" ON lg_venues FOR DELETE TO authenticated USING (true);

NOTIFY pgrst, 'reload schema';

-- ── Verificación rápida (opcional) ────────────────────────────
-- Corre esto aparte para confirmar que ya están todas las columnas:
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'lg_venues' ORDER BY ordinal_position;
