-- =============================================================================
-- Migration: Módulo de Transferencias de Jugadores y KPIs
-- Archivo: 20260808_transfers_kpis.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS lg_transfers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NULL,
  player_id           UUID NOT NULL REFERENCES lg_players(id) ON DELETE CASCADE,
  from_club_id        UUID NOT NULL REFERENCES lg_clubs(id) ON DELETE CASCADE,
  to_club_id          UUID NOT NULL REFERENCES lg_clubs(id) ON DELETE CASCADE,
  transfer_date       TIMESTAMPTZ NOT NULL DEFAULT now(),
  fee                 NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  status              TEXT NOT NULL DEFAULT 'PENDING',
  requested_by        UUID NULL,
  approved_by         UUID NULL,
  notes               TEXT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Asegurar columnas si la tabla ya existía previamente
ALTER TABLE lg_transfers ADD COLUMN IF NOT EXISTS org_id              UUID NULL;
ALTER TABLE lg_transfers ADD COLUMN IF NOT EXISTS transfer_date       TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE lg_transfers ADD COLUMN IF NOT EXISTS fee                 NUMERIC(12,2) NOT NULL DEFAULT 0.00;
ALTER TABLE lg_transfers ADD COLUMN IF NOT EXISTS requested_by        UUID NULL;
ALTER TABLE lg_transfers ADD COLUMN IF NOT EXISTS approved_by         UUID NULL;
ALTER TABLE lg_transfers ADD COLUMN IF NOT EXISTS notes               TEXT NULL;
ALTER TABLE lg_transfers ADD COLUMN IF NOT EXISTS created_at          TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE lg_transfers ADD COLUMN IF NOT EXISTS updated_at          TIMESTAMPTZ NOT NULL DEFAULT now();

-- Constraint de estados válidos (soporta inglés y español)
ALTER TABLE lg_transfers DROP CONSTRAINT IF EXISTS lg_transfers_status_check;
ALTER TABLE lg_transfers ADD CONSTRAINT lg_transfers_status_check
  CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'ENVIADO', 'ACEPTADO', 'RECHAZADO', 'CANCELADO'));

-- Índices de alto rendimiento para filtrado y KPIs
CREATE INDEX IF NOT EXISTS idx_transfers_player_id      ON lg_transfers(player_id);
CREATE INDEX IF NOT EXISTS idx_transfers_from_club_id   ON lg_transfers(from_club_id);
CREATE INDEX IF NOT EXISTS idx_transfers_to_club_id     ON lg_transfers(to_club_id);
CREATE INDEX IF NOT EXISTS idx_transfers_status         ON lg_transfers(status);
CREATE INDEX IF NOT EXISTS idx_transfers_created_at     ON lg_transfers(created_at);
CREATE INDEX IF NOT EXISTS idx_transfers_org_id         ON lg_transfers(org_id);

-- Vista de compatibilidad `transfers` con alias de columnas origin_club_id y destination_club_id
CREATE OR REPLACE VIEW transfers AS
SELECT
  id,
  org_id,
  player_id,
  from_club_id AS origin_club_id,
  to_club_id   AS destination_club_id,
  from_club_id,
  to_club_id,
  transfer_date,
  fee,
  status,
  requested_by,
  approved_by,
  notes,
  created_at,
  updated_at
FROM lg_transfers;

-- =============================================================================
-- SEGURIDAD: Row Level Security (RLS) en Supabase
-- =============================================================================
ALTER TABLE lg_transfers ENABLE ROW LEVEL SECURITY;

-- 1. SELECT Policy: Usuarios autenticados pueden ver transferencias
DROP POLICY IF EXISTS "transfers_select_policy" ON lg_transfers;
CREATE POLICY "transfers_select_policy" ON lg_transfers
  FOR SELECT TO authenticated
  USING (true);

-- 2. INSERT Policy: Permitir crear transferencias
DROP POLICY IF EXISTS "transfers_insert_policy" ON lg_transfers;
CREATE POLICY "transfers_insert_policy" ON lg_transfers
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- 3. UPDATE Policy: Permitir aprobar/rechazar o cancelar la transferencia
DROP POLICY IF EXISTS "transfers_update_policy" ON lg_transfers;
CREATE POLICY "transfers_update_policy" ON lg_transfers
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

-- 4. DELETE Policy: Permitir cancelar/eliminar a usuarios autenticados autorizados
DROP POLICY IF EXISTS "transfers_delete_policy" ON lg_transfers;
CREATE POLICY "transfers_delete_policy" ON lg_transfers
  FOR DELETE TO authenticated
  USING (true);
