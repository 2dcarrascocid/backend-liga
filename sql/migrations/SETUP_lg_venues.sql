-- ============================================================
-- Setup consolidado: lg_venues (estado final actual)
-- Ejecutar una sola vez en el SQL Editor de Supabase.
-- Equivale a aplicar en orden:
--   20260807_lg_venues.sql
--   20260807_lg_venues_schedule.sql
--   20260807_lg_venues_drop_capacity_schedule.sql
--   20260808_lg_venues_add_region.sql
-- (se consolidan aquí porque ninguna se había ejecutado aún
--  contra la base real — evita el vaivén de agregar columnas
--  de horario y luego eliminarlas)
-- ============================================================

CREATE TABLE IF NOT EXISTS lg_venues (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  org_id        uuid        NOT NULL,
  CONSTRAINT lg_venues_pkey PRIMARY KEY (id),
  CONSTRAINT lg_venues_org_id_fkey FOREIGN KEY (org_id) REFERENCES lg_orgs (id) ON DELETE CASCADE
);

-- Si lg_venues ya existía de antes (aunque sea un stub con pocas
-- columnas), "CREATE TABLE IF NOT EXISTS" de arriba no la completa.
-- Por eso cada columna se fuerza acá individualmente (idempotente).
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
