-- ============================================================
-- Migration: lg_club_series
-- Descripción: Gestión de Series por Equipo. Un Club puede tener
--              múltiples Series (Serie Honor, Serie A, Senior, etc.),
--              cada una con su propia nómina. La Serie —no el Club—
--              pasa a ser la entidad que se inscribe y juega en un
--              torneo, por lo que esta migración renombra el
--              identificador de "equipo participante" de club_id a
--              series_id en lg_tournament_teams, lg_matches y
--              lg_match_events.
--
-- IMPORTANTE — migración de datos:
--   Se crea automáticamente una serie "Principal" por cada club ya
--   existente, y todo lo que hoy está inscrito/jugado bajo club_id
--   se reasigna a esa serie "Principal" antes de eliminar las
--   columnas viejas. No se pierde información; se puede renombrar
--   o repartir en series adicionales después de correr este script.
--
-- Fecha: 2026-08-14
-- ============================================================

-- ============================================================
-- lg_club_series — Series de un Club
-- ============================================================
CREATE TABLE IF NOT EXISTS lg_club_series (
  id           uuid        NOT NULL DEFAULT gen_random_uuid(),
  club_id      uuid        NOT NULL,
  name         text        NOT NULL,
  category_id  uuid        NULL,
  active       boolean     NOT NULL DEFAULT true,
  created_at   timestamp with time zone NOT NULL DEFAULT now(),
  updated_at   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT lg_club_series_pkey PRIMARY KEY (id),
  CONSTRAINT lg_club_series_club_id_fkey FOREIGN KEY (club_id) REFERENCES lg_clubs (id) ON DELETE CASCADE,
  CONSTRAINT lg_club_series_category_id_fkey FOREIGN KEY (category_id) REFERENCES lg_categories (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_club_series_club_id ON lg_club_series(club_id);
CREATE INDEX IF NOT EXISTS idx_club_series_active ON lg_club_series(active);

ALTER TABLE lg_club_series ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lg_club_series_select" ON lg_club_series FOR SELECT TO authenticated USING (true);
CREATE POLICY "lg_club_series_insert" ON lg_club_series FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "lg_club_series_update" ON lg_club_series FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "lg_club_series_delete" ON lg_club_series FOR DELETE TO authenticated USING (true);

-- ============================================================
-- lg_club_rosters — vínculo opcional a la serie del jugador
-- ============================================================
ALTER TABLE lg_club_rosters ADD COLUMN IF NOT EXISTS series_id uuid NULL;

ALTER TABLE lg_club_rosters
  ADD CONSTRAINT lg_club_rosters_series_id_fkey FOREIGN KEY (series_id) REFERENCES lg_club_series (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_club_rosters_series_id ON lg_club_rosters(series_id);

-- ============================================================
-- Backfill: una serie "Principal" por cada club existente
-- ============================================================
INSERT INTO lg_club_series (club_id, name)
SELECT id, 'Principal' FROM lg_clubs;

-- ============================================================
-- lg_tournament_teams: club_id -> series_id
-- ============================================================
ALTER TABLE lg_tournament_teams ADD COLUMN IF NOT EXISTS series_id uuid NULL;

UPDATE lg_tournament_teams tt
SET series_id = cs.id
FROM lg_club_series cs
WHERE cs.club_id = tt.club_id AND cs.name = 'Principal' AND tt.series_id IS NULL;

ALTER TABLE lg_tournament_teams ALTER COLUMN series_id SET NOT NULL;

ALTER TABLE lg_tournament_teams
  ADD CONSTRAINT lg_tournament_teams_series_id_fkey FOREIGN KEY (series_id) REFERENCES lg_club_series (id) ON DELETE CASCADE;

ALTER TABLE lg_tournament_teams DROP CONSTRAINT IF EXISTS lg_tournament_teams_unique;
ALTER TABLE lg_tournament_teams
  ADD CONSTRAINT lg_tournament_teams_unique UNIQUE (tournament_id, series_id);

ALTER TABLE lg_tournament_teams DROP CONSTRAINT IF EXISTS lg_tournament_teams_club_id_fkey;
DROP INDEX IF EXISTS idx_tournament_teams_club_id;
ALTER TABLE lg_tournament_teams DROP COLUMN IF EXISTS club_id;

CREATE INDEX IF NOT EXISTS idx_tournament_teams_series_id ON lg_tournament_teams(series_id);

-- ============================================================
-- lg_matches: home_club_id/away_club_id/winner_club_id -> _series_id
-- ============================================================
ALTER TABLE lg_matches ADD COLUMN IF NOT EXISTS home_series_id   uuid NULL;
ALTER TABLE lg_matches ADD COLUMN IF NOT EXISTS away_series_id   uuid NULL;
ALTER TABLE lg_matches ADD COLUMN IF NOT EXISTS winner_series_id uuid NULL;

UPDATE lg_matches m
SET home_series_id = cs.id
FROM lg_club_series cs
WHERE cs.club_id = m.home_club_id AND cs.name = 'Principal' AND m.home_club_id IS NOT NULL AND m.home_series_id IS NULL;

UPDATE lg_matches m
SET away_series_id = cs.id
FROM lg_club_series cs
WHERE cs.club_id = m.away_club_id AND cs.name = 'Principal' AND m.away_club_id IS NOT NULL AND m.away_series_id IS NULL;

UPDATE lg_matches m
SET winner_series_id = cs.id
FROM lg_club_series cs
WHERE cs.club_id = m.winner_club_id AND cs.name = 'Principal' AND m.winner_club_id IS NOT NULL AND m.winner_series_id IS NULL;

ALTER TABLE lg_matches
  ADD CONSTRAINT lg_matches_home_series_id_fkey FOREIGN KEY (home_series_id) REFERENCES lg_club_series (id) ON DELETE SET NULL,
  ADD CONSTRAINT lg_matches_away_series_id_fkey FOREIGN KEY (away_series_id) REFERENCES lg_club_series (id) ON DELETE SET NULL,
  ADD CONSTRAINT lg_matches_winner_series_id_fkey FOREIGN KEY (winner_series_id) REFERENCES lg_club_series (id) ON DELETE SET NULL;

ALTER TABLE lg_matches DROP CONSTRAINT IF EXISTS lg_matches_home_club_id_fkey;
ALTER TABLE lg_matches DROP CONSTRAINT IF EXISTS lg_matches_away_club_id_fkey;
ALTER TABLE lg_matches DROP CONSTRAINT IF EXISTS lg_matches_winner_club_id_fkey;
DROP INDEX IF EXISTS idx_matches_home_club_id;
DROP INDEX IF EXISTS idx_matches_away_club_id;
ALTER TABLE lg_matches DROP COLUMN IF EXISTS home_club_id;
ALTER TABLE lg_matches DROP COLUMN IF EXISTS away_club_id;
ALTER TABLE lg_matches DROP COLUMN IF EXISTS winner_club_id;

CREATE INDEX IF NOT EXISTS idx_matches_home_series_id ON lg_matches(home_series_id);
CREATE INDEX IF NOT EXISTS idx_matches_away_series_id ON lg_matches(away_series_id);

-- ============================================================
-- lg_match_events: club_id -> series_id
-- ============================================================
ALTER TABLE lg_match_events ADD COLUMN IF NOT EXISTS series_id uuid NULL;

UPDATE lg_match_events e
SET series_id = cs.id
FROM lg_club_series cs
WHERE cs.club_id = e.club_id AND cs.name = 'Principal' AND e.series_id IS NULL;

ALTER TABLE lg_match_events ALTER COLUMN series_id SET NOT NULL;

ALTER TABLE lg_match_events
  ADD CONSTRAINT lg_match_events_series_id_fkey FOREIGN KEY (series_id) REFERENCES lg_club_series (id) ON DELETE CASCADE;

ALTER TABLE lg_match_events DROP CONSTRAINT IF EXISTS lg_match_events_club_id_fkey;
ALTER TABLE lg_match_events DROP COLUMN IF EXISTS club_id;

CREATE INDEX IF NOT EXISTS idx_match_events_series_id ON lg_match_events(series_id);

-- ============================================================
-- Vista: vw_tournament_standings — ahora agrupada por serie
-- ============================================================
DROP VIEW IF EXISTS vw_tournament_standings;

CREATE VIEW vw_tournament_standings AS
WITH match_rows AS (
  SELECT
    m.tournament_id,
    m.stage_id,
    m.group_name,
    m.home_series_id AS series_id,
    m.home_score      AS gf,
    m.away_score      AS gc,
    CASE WHEN m.home_score > m.away_score THEN 1 ELSE 0 END AS win,
    CASE WHEN m.home_score = m.away_score THEN 1 ELSE 0 END AS draw,
    CASE WHEN m.home_score < m.away_score THEN 1 ELSE 0 END AS loss
  FROM lg_matches m
  JOIN lg_tournament_stages s ON s.id = m.stage_id
  WHERE m.status = 'FINISHED'
    AND m.home_score IS NOT NULL
    AND m.away_score IS NOT NULL
    AND m.home_series_id IS NOT NULL
    AND (s.stage_type = 'GROUP' OR s.is_consolation = true)

  UNION ALL

  SELECT
    m.tournament_id,
    m.stage_id,
    m.group_name,
    m.away_series_id AS series_id,
    m.away_score      AS gf,
    m.home_score      AS gc,
    CASE WHEN m.away_score > m.home_score THEN 1 ELSE 0 END AS win,
    CASE WHEN m.away_score = m.home_score THEN 1 ELSE 0 END AS draw,
    CASE WHEN m.away_score < m.home_score THEN 1 ELSE 0 END AS loss
  FROM lg_matches m
  JOIN lg_tournament_stages s ON s.id = m.stage_id
  WHERE m.status = 'FINISHED'
    AND m.home_score IS NOT NULL
    AND m.away_score IS NOT NULL
    AND m.away_series_id IS NOT NULL
    AND (s.stage_type = 'GROUP' OR s.is_consolation = true)
),
aggregated AS (
  SELECT
    mr.tournament_id,
    mr.stage_id,
    mr.group_name,
    mr.series_id,
    cs.name                                   AS series_name,
    cs.club_id                                AS club_id,
    c.name                                     AS club_name,
    COUNT(*)::int                             AS played,
    SUM(mr.win)::int                          AS won,
    SUM(mr.draw)::int                         AS drawn,
    SUM(mr.loss)::int                         AS lost,
    SUM(mr.gf)::int                           AS goals_for,
    SUM(mr.gc)::int                           AS goals_against,
    (SUM(mr.gf) - SUM(mr.gc))::int            AS goal_diff,
    (SUM(mr.win) * t.points_win
      + SUM(mr.draw) * t.points_draw
      + SUM(mr.loss) * t.points_loss)::int    AS points
  FROM match_rows mr
  JOIN lg_club_series cs ON cs.id = mr.series_id
  JOIN lg_clubs c        ON c.id = cs.club_id
  JOIN lg_tournaments t  ON t.id = mr.tournament_id
  GROUP BY mr.tournament_id, mr.stage_id, mr.group_name, mr.series_id, cs.name, cs.club_id, c.name,
           t.points_win, t.points_draw, t.points_loss
)
SELECT
  a.*,
  RANK() OVER (
    PARTITION BY a.tournament_id, a.stage_id, a.group_name
    ORDER BY a.points DESC, a.goal_diff DESC, a.goals_for DESC
  ) AS position
FROM aggregated a
ORDER BY a.tournament_id, a.stage_id, a.group_name, position;

NOTIFY pgrst, 'reload schema';
