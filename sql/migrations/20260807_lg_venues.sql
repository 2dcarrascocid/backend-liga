-- ============================================================
-- Migration: lg_venues
-- Descripción: Tabla para el mantenedor de canchas de la
--              organización (dashboard, listado y CRUD).
-- Fecha: 2026-08-07
-- ============================================================

CREATE TABLE IF NOT EXISTS lg_venues (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  org_id        uuid        NOT NULL,
  name          text        NOT NULL,
  address       text        NULL,
  city          text        NULL,
  surface_type  text        NOT NULL DEFAULT 'NATURAL',
  capacity      integer     NULL,
  lighting      boolean     NOT NULL DEFAULT false,
  status        text        NOT NULL DEFAULT 'DISPONIBLE',
  notes         text        NULL,
  created_at    timestamp with time zone NOT NULL DEFAULT now(),
  updated_at    timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT lg_venues_pkey PRIMARY KEY (id),
  CONSTRAINT lg_venues_org_id_fkey FOREIGN KEY (org_id) REFERENCES lg_orgs (id) ON DELETE CASCADE,
  CONSTRAINT lg_venues_surface_type_check CHECK (surface_type IN ('NATURAL', 'SINTETICA', 'CEMENTO', 'OTRA')),
  CONSTRAINT lg_venues_status_check CHECK (status IN ('DISPONIBLE', 'MANTENIMIENTO', 'INACTIVA'))
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_venues_org_id
  ON lg_venues(org_id);

CREATE INDEX IF NOT EXISTS idx_venues_status
  ON lg_venues(status);

-- ============================================================
-- RLS
-- Todos los accesos van por el backend con service_role,
-- que bypasea RLS por defecto en Supabase.
-- Se habilita RLS de todas formas para proteger accesos directos,
-- con políticas explícitas para cada operación del backend.
-- ============================================================

ALTER TABLE lg_venues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venues_select"
  ON lg_venues
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "venues_insert"
  ON lg_venues
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "venues_update"
  ON lg_venues
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "venues_delete"
  ON lg_venues
  FOR DELETE
  TO authenticated
  USING (true);

NOTIFY pgrst, 'reload schema';
