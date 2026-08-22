-- ============================================================
-- Migration: lg_seasons_and_tournament_type
-- Descripción: Introduce "Temporada" (ej: "Temporada 2026") como nivel
--              por encima de Torneo, y un tipo de torneo AMISTOSO/OFICIAL.
--
--              - Nueva tabla lg_seasons (org_id, name, year, active).
--              - lg_tournaments.season_id  → FK a lg_seasons (nullable:
--                la app exige seasonId en CREATE_TOURNAMENT — ver
--                tournaments_specialist.js — pero se deja nullable a
--                nivel de BD para no romper si esta migración corre
--                antes que el reset de datos de torneos).
--              - lg_tournaments.type       → 'AMISTOSO' | 'OFICIAL', default 'OFICIAL'.
--              - Se elimina la columna de texto libre lg_tournaments.season
--                (reemplazada por season_id).
--
-- Nota: es idempotente. Se puede correr las veces que haga falta.
-- Fecha: 2026-08-21
-- ============================================================

CREATE TABLE IF NOT EXISTS lg_seasons (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL,
  name        text        NOT NULL,
  year        integer     NOT NULL,
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamp with time zone NOT NULL DEFAULT now(),
  updated_at  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT lg_seasons_pkey PRIMARY KEY (id),
  CONSTRAINT lg_seasons_org_id_fkey FOREIGN KEY (org_id) REFERENCES lg_orgs (id) ON DELETE CASCADE,
  CONSTRAINT lg_seasons_org_name_key UNIQUE (org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_lg_seasons_org_id ON lg_seasons(org_id);
CREATE INDEX IF NOT EXISTS idx_lg_seasons_year   ON lg_seasons(year);

ALTER TABLE lg_seasons ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lg_seasons' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON lg_seasons', pol.policyname);
  END LOOP;
END $$;

-- Mismo criterio que 20260818_unify_rls_all_tables.sql: el backend habla
-- con Supabase con una clave de rol 'anon', no 'service_role'.
CREATE POLICY "lg_seasons_select" ON lg_seasons FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "lg_seasons_insert" ON lg_seasons FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "lg_seasons_update" ON lg_seasons FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "lg_seasons_delete" ON lg_seasons FOR DELETE TO anon, authenticated USING (true);

-- ── lg_tournaments: season_id + type ───────────────────────────────────────

ALTER TABLE lg_tournaments
  ADD COLUMN IF NOT EXISTS season_id uuid,
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'OFICIAL';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'lg_tournaments_season_id_fkey'
  ) THEN
    ALTER TABLE lg_tournaments
      ADD CONSTRAINT lg_tournaments_season_id_fkey
      FOREIGN KEY (season_id) REFERENCES lg_seasons (id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'lg_tournaments_type_check'
  ) THEN
    ALTER TABLE lg_tournaments
      ADD CONSTRAINT lg_tournaments_type_check CHECK (type IN ('AMISTOSO', 'OFICIAL'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_lg_tournaments_season_id ON lg_tournaments(season_id);
CREATE INDEX IF NOT EXISTS idx_lg_tournaments_type      ON lg_tournaments(type);

-- El texto libre "season" queda reemplazado por season_id → lg_seasons.
ALTER TABLE lg_tournaments DROP COLUMN IF EXISTS season;

NOTIFY pgrst, 'reload schema';
