-- ============================================================
-- Migration: lg_referees
-- Descripción: Tabla para el mantenedor de árbitros de la
--              organización (dashboard, listado y CRUD).
-- Fecha: 2026-08-07
-- ============================================================

CREATE TABLE IF NOT EXISTS lg_referees (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL,
  full_name   text        NOT NULL,
  phone       text        NULL,
  email       text        NULL,
  notes       text        NULL,
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamp with time zone NOT NULL DEFAULT now(),
  updated_at  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT lg_referees_pkey PRIMARY KEY (id),
  CONSTRAINT lg_referees_org_id_fkey FOREIGN KEY (org_id) REFERENCES lg_orgs (id) ON DELETE CASCADE
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_referees_org_id
  ON lg_referees(org_id);

CREATE INDEX IF NOT EXISTS idx_referees_active
  ON lg_referees(active);

-- ============================================================
-- RLS
-- Todos los accesos van por el backend con service_role,
-- que bypasea RLS por defecto en Supabase.
-- Se habilita RLS de todas formas para proteger accesos directos,
-- con políticas explícitas para cada operación del backend.
-- ============================================================

ALTER TABLE lg_referees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "referees_select"
  ON lg_referees
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "referees_insert"
  ON lg_referees
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "referees_update"
  ON lg_referees
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "referees_delete"
  ON lg_referees
  FOR DELETE
  TO authenticated
  USING (true);

NOTIFY pgrst, 'reload schema';
