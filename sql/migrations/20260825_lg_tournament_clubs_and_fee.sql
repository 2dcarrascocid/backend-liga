-- ============================================================
-- Migration: lg_tournament_clubs_and_fee
-- Descripción: Inscripción de club a torneo + costo de inscripción
--              propio por torneo.
--
--   - lg_tournaments.inscription_fee: costo de inscripción propio del
--     torneo (reemplaza, para el cobro INSCRIPCION, al valor único por
--     temporada de lg_season_cost_catalog — ese catálogo sigue vigente
--     solo para matchday_fee / cobro FECHA). Default 0 para no romper
--     filas existentes; la obligatoriedad de "costo > 0 al crear" la
--     exige el backend en CREATE_TOURNAMENT, no un CHECK en DB.
--
--   - lg_tournament_clubs: "club inscrito en un torneo" — gate previo
--     a lg_tournament_teams (hoy una serie se inscribe directo a un
--     torneo sin que su club esté inscrito primero). Un club se
--     inscribe una sola vez por torneo (UNIQUE tournament_id, club_id).
--     Sin columna de estado: el pendiente/pagado se deriva del
--     lg_ledger_entries (categoría INSCRIPCION) asociado a ese
--     club_id + tournament_id — mismo criterio que ya usa el módulo
--     de ledger (computeEntryStatus en runtime, sin cron de sync).
--
-- Nota: es idempotente. Se puede correr las veces que haga falta.
-- Fecha: 2026-08-25
-- ============================================================

-- ── lg_tournaments.inscription_fee ──────────────────────────
ALTER TABLE lg_tournaments ADD COLUMN IF NOT EXISTS inscription_fee numeric(12,2) NOT NULL DEFAULT 0;

-- ============================================================
-- lg_tournament_clubs — Clubes inscritos en un torneo
-- ============================================================
CREATE TABLE IF NOT EXISTS lg_tournament_clubs (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tournament_id  uuid        NOT NULL,
  club_id        uuid        NOT NULL,
  registered_by  uuid        NULL,
  created_at     timestamp with time zone NOT NULL DEFAULT now(),
  updated_at     timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT lg_tournament_clubs_pkey PRIMARY KEY (id),
  CONSTRAINT lg_tournament_clubs_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES lg_tournaments (id) ON DELETE CASCADE,
  CONSTRAINT lg_tournament_clubs_club_id_fkey FOREIGN KEY (club_id) REFERENCES lg_clubs (id) ON DELETE CASCADE,
  CONSTRAINT lg_tournament_clubs_unique UNIQUE (tournament_id, club_id)
);

CREATE INDEX IF NOT EXISTS idx_tournament_clubs_tournament_id ON lg_tournament_clubs(tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournament_clubs_club_id       ON lg_tournament_clubs(club_id);

-- ── RLS — mismo criterio que 20260818_unify_rls_all_tables.sql /
--    20260821_lg_ledger_and_cost_catalog.sql: el backend habla con
--    Supabase con una clave de rol 'anon', no 'service_role'.
ALTER TABLE lg_tournament_clubs ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lg_tournament_clubs' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON lg_tournament_clubs', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "lg_tournament_clubs_select" ON lg_tournament_clubs FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "lg_tournament_clubs_insert" ON lg_tournament_clubs FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "lg_tournament_clubs_update" ON lg_tournament_clubs FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "lg_tournament_clubs_delete" ON lg_tournament_clubs FOR DELETE TO anon, authenticated USING (true);

NOTIFY pgrst, 'reload schema';
