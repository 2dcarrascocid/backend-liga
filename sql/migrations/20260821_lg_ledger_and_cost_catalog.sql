-- ============================================================
-- Migration: lg_ledger_and_cost_catalog
-- Descripción: Módulo financiero de torneos.
--
--   - lg_season_cost_catalog: "mantenedor de costos" — un costo de
--     inscripción y un costo por fecha, configurados una vez por temporada.
--     Todos los torneos de esa temporada usan esos valores.
--
--   - lg_ledger_entries: libro de ingresos/egresos por club. Categorías
--     INSCRIPCION | FECHA | MULTA | OTRO | VALOR, dirección INGRESO | EGRESO.
--     INSCRIPCION se genera al inscribir una serie a un torneo; FECHA se
--     genera por cada matchday del fixture (una fila por serie ACTIVE
--     inscrita — un club con 2 series paga 2 veces). MULTA/OTRO/VALOR son
--     altas manuales del administrador de organización.
--
--     No tiene columna de estado: se calcula en la app a partir de
--     paid_amount/due_date (PAGADO/PARCIAL/VENCIDO/PENDIENTE) — mismo
--     criterio que is_veteran en el módulo de folios, para no necesitar
--     un cron que lo mantenga sincronizado.
--
-- Nota: es idempotente. Se puede correr las veces que haga falta.
-- Fecha: 2026-08-21
-- ============================================================

CREATE TABLE IF NOT EXISTS lg_season_cost_catalog (
  id               uuid        NOT NULL DEFAULT gen_random_uuid(),
  org_id           uuid        NOT NULL,
  season_id        uuid        NOT NULL,
  inscription_fee  numeric(12,2) NOT NULL DEFAULT 0,
  matchday_fee     numeric(12,2) NOT NULL DEFAULT 0,
  created_at       timestamp with time zone NOT NULL DEFAULT now(),
  updated_at       timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT lg_season_cost_catalog_pkey PRIMARY KEY (id),
  CONSTRAINT lg_season_cost_catalog_org_id_fkey FOREIGN KEY (org_id) REFERENCES lg_orgs (id) ON DELETE CASCADE,
  CONSTRAINT lg_season_cost_catalog_season_id_fkey FOREIGN KEY (season_id) REFERENCES lg_seasons (id) ON DELETE CASCADE,
  CONSTRAINT lg_season_cost_catalog_season_id_key UNIQUE (season_id)
);

CREATE TABLE IF NOT EXISTS lg_ledger_entries (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  org_id        uuid        NOT NULL,
  club_id       uuid        NOT NULL,
  series_id     uuid        NULL,
  tournament_id uuid        NULL,
  matchday_id   uuid        NULL,
  category      text        NOT NULL,
  direction     text        NOT NULL DEFAULT 'INGRESO',
  amount        numeric(12,2) NOT NULL DEFAULT 0,
  description   text        NULL,
  due_date      date        NULL,
  paid_amount   numeric(12,2) NOT NULL DEFAULT 0,
  paid_at       timestamp with time zone NULL,
  recorded_by   uuid        NULL,
  created_at    timestamp with time zone NOT NULL DEFAULT now(),
  updated_at    timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT lg_ledger_entries_pkey PRIMARY KEY (id),
  CONSTRAINT lg_ledger_entries_org_id_fkey FOREIGN KEY (org_id) REFERENCES lg_orgs (id) ON DELETE CASCADE,
  CONSTRAINT lg_ledger_entries_club_id_fkey FOREIGN KEY (club_id) REFERENCES lg_clubs (id) ON DELETE CASCADE,
  CONSTRAINT lg_ledger_entries_series_id_fkey FOREIGN KEY (series_id) REFERENCES lg_club_series (id) ON DELETE SET NULL,
  CONSTRAINT lg_ledger_entries_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES lg_tournaments (id) ON DELETE SET NULL,
  CONSTRAINT lg_ledger_entries_matchday_id_fkey FOREIGN KEY (matchday_id) REFERENCES lg_matchdays (id) ON DELETE SET NULL,
  CONSTRAINT lg_ledger_entries_category_check CHECK (category IN ('INSCRIPCION', 'FECHA', 'MULTA', 'OTRO', 'VALOR')),
  CONSTRAINT lg_ledger_entries_direction_check CHECK (direction IN ('INGRESO', 'EGRESO'))
);

CREATE INDEX IF NOT EXISTS idx_lg_ledger_entries_club_id       ON lg_ledger_entries(club_id);
CREATE INDEX IF NOT EXISTS idx_lg_ledger_entries_series_id     ON lg_ledger_entries(series_id);
CREATE INDEX IF NOT EXISTS idx_lg_ledger_entries_tournament_id ON lg_ledger_entries(tournament_id);
CREATE INDEX IF NOT EXISTS idx_lg_ledger_entries_matchday_id   ON lg_ledger_entries(matchday_id);
CREATE INDEX IF NOT EXISTS idx_lg_ledger_entries_category      ON lg_ledger_entries(category);
CREATE INDEX IF NOT EXISTS idx_lg_season_cost_catalog_org_id   ON lg_season_cost_catalog(org_id);

-- ── RLS — mismo criterio que 20260818_unify_rls_all_tables.sql / 20260821_lg_seasons_and_tournament_type.sql:
--    el backend habla con Supabase con una clave de rol 'anon', no 'service_role'.
ALTER TABLE lg_season_cost_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE lg_ledger_entries      ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lg_season_cost_catalog' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON lg_season_cost_catalog', pol.policyname);
  END LOOP;
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lg_ledger_entries' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON lg_ledger_entries', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "lg_season_cost_catalog_select" ON lg_season_cost_catalog FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "lg_season_cost_catalog_insert" ON lg_season_cost_catalog FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "lg_season_cost_catalog_update" ON lg_season_cost_catalog FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "lg_season_cost_catalog_delete" ON lg_season_cost_catalog FOR DELETE TO anon, authenticated USING (true);

CREATE POLICY "lg_ledger_entries_select" ON lg_ledger_entries FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "lg_ledger_entries_insert" ON lg_ledger_entries FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "lg_ledger_entries_update" ON lg_ledger_entries FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "lg_ledger_entries_delete" ON lg_ledger_entries FOR DELETE TO anon, authenticated USING (true);

NOTIFY pgrst, 'reload schema';
