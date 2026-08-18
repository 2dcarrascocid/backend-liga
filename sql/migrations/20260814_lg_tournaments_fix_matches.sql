-- ============================================================
-- Fix: 20260814_lg_tournaments_fix_matches
-- Descripción: La migración 20260814_lg_tournaments.sql se topó
--              con una tabla `lg_matches` PREEXISTENTE e incompatible
--              (esquema antiguo: competition_id, round_id, etc., sin
--              relación con ningún código del repo — confirmado vacía
--              por el usuario). CREATE TABLE IF NOT EXISTS no la tocó,
--              por lo que el índice sobre tournament_id y finalmente
--              la vista vw_tournament_standings fallaron con 42703.
--
--              Este script reemplaza esa tabla (y las dos que ya
--              habían quedado creadas apuntando a ella por FK:
--              lg_match_events y lg_match_costs) por el esquema
--              correcto, y crea la vista que había quedado pendiente.
--
-- IMPORTANTE: Ejecutar `select count(*) from lg_matches;` ANTES de
--             correr este script y confirmar que da 0. Si no da 0,
--             detenerse — no correr este fix.
-- Fecha: 2026-08-14
-- ============================================================

DROP TABLE IF EXISTS lg_match_events CASCADE;
DROP TABLE IF EXISTS lg_match_costs CASCADE;
DROP TABLE IF EXISTS lg_matches CASCADE;

-- ============================================================
-- lg_matches — Partidos (esquema correcto)
-- ============================================================
CREATE TABLE lg_matches (
  id                     uuid        NOT NULL DEFAULT gen_random_uuid(),
  tournament_id          uuid        NOT NULL,
  stage_id               uuid        NOT NULL,
  matchday_id            uuid        NULL,
  group_name             text        NULL,
  round_number           integer     NULL,
  leg_number             integer     NOT NULL DEFAULT 1,
  home_club_id           uuid        NULL,
  away_club_id           uuid        NULL,
  home_score             integer     NULL,
  away_score             integer     NULL,
  home_penalty_score     integer     NULL,
  away_penalty_score     integer     NULL,
  winner_club_id         uuid        NULL,
  home_source_match_id   uuid        NULL,
  away_source_match_id   uuid        NULL,
  home_source_is_loser   boolean     NOT NULL DEFAULT false,
  away_source_is_loser   boolean     NOT NULL DEFAULT false,
  status                 text        NOT NULL DEFAULT 'SCHEDULED',
  venue_id               uuid        NULL,
  referee_id             uuid        NULL,
  match_date             date        NULL,
  match_time             time        NULL,
  time_slot              text        NULL,
  observations           text        NULL,
  created_at             timestamp with time zone NOT NULL DEFAULT now(),
  updated_at             timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT lg_matches_pkey PRIMARY KEY (id),
  CONSTRAINT lg_matches_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES lg_tournaments (id) ON DELETE CASCADE,
  CONSTRAINT lg_matches_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES lg_tournament_stages (id) ON DELETE CASCADE,
  CONSTRAINT lg_matches_matchday_id_fkey FOREIGN KEY (matchday_id) REFERENCES lg_matchdays (id) ON DELETE SET NULL,
  CONSTRAINT lg_matches_home_club_id_fkey FOREIGN KEY (home_club_id) REFERENCES lg_clubs (id) ON DELETE SET NULL,
  CONSTRAINT lg_matches_away_club_id_fkey FOREIGN KEY (away_club_id) REFERENCES lg_clubs (id) ON DELETE SET NULL,
  CONSTRAINT lg_matches_winner_club_id_fkey FOREIGN KEY (winner_club_id) REFERENCES lg_clubs (id) ON DELETE SET NULL,
  CONSTRAINT lg_matches_home_source_match_id_fkey FOREIGN KEY (home_source_match_id) REFERENCES lg_matches (id) ON DELETE SET NULL,
  CONSTRAINT lg_matches_away_source_match_id_fkey FOREIGN KEY (away_source_match_id) REFERENCES lg_matches (id) ON DELETE SET NULL,
  CONSTRAINT lg_matches_venue_id_fkey FOREIGN KEY (venue_id) REFERENCES lg_venues (id) ON DELETE SET NULL,
  CONSTRAINT lg_matches_referee_id_fkey FOREIGN KEY (referee_id) REFERENCES lg_referees (id) ON DELETE SET NULL,
  CONSTRAINT lg_matches_status_check CHECK (status IN ('SCHEDULED', 'IN_PROGRESS', 'FINISHED', 'POSTPONED', 'WALKOVER', 'CANCELLED'))
);

CREATE INDEX idx_matches_tournament_id ON lg_matches(tournament_id);
CREATE INDEX idx_matches_stage_id ON lg_matches(stage_id);
CREATE INDEX idx_matches_matchday_id ON lg_matches(matchday_id);
CREATE INDEX idx_matches_status ON lg_matches(status);
CREATE INDEX idx_matches_home_club_id ON lg_matches(home_club_id);
CREATE INDEX idx_matches_away_club_id ON lg_matches(away_club_id);
CREATE INDEX idx_matches_home_source_match_id ON lg_matches(home_source_match_id);
CREATE INDEX idx_matches_away_source_match_id ON lg_matches(away_source_match_id);
CREATE INDEX idx_matches_venue_id ON lg_matches(venue_id);
CREATE INDEX idx_matches_referee_id ON lg_matches(referee_id);

-- ============================================================
-- lg_match_events — Goles, tarjetas y amonestaciones
-- ============================================================
CREATE TABLE lg_match_events (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  match_id    uuid        NOT NULL,
  club_id     uuid        NOT NULL,
  player_id   uuid        NULL,
  event_type  text        NOT NULL,
  minute      integer     NULL,
  notes       text        NULL,
  created_at  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT lg_match_events_pkey PRIMARY KEY (id),
  CONSTRAINT lg_match_events_match_id_fkey FOREIGN KEY (match_id) REFERENCES lg_matches (id) ON DELETE CASCADE,
  CONSTRAINT lg_match_events_club_id_fkey FOREIGN KEY (club_id) REFERENCES lg_clubs (id) ON DELETE CASCADE,
  CONSTRAINT lg_match_events_player_id_fkey FOREIGN KEY (player_id) REFERENCES lg_players (id) ON DELETE SET NULL,
  CONSTRAINT lg_match_events_type_check CHECK (event_type IN ('GOAL', 'OWN_GOAL', 'YELLOW_CARD', 'RED_CARD', 'WARNING'))
);

CREATE INDEX idx_match_events_match_id ON lg_match_events(match_id);
CREATE INDEX idx_match_events_player_id ON lg_match_events(player_id);
CREATE INDEX idx_match_events_type ON lg_match_events(event_type);

-- ============================================================
-- lg_match_costs — Costos específicos por Partido
-- ============================================================
CREATE TABLE lg_match_costs (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  match_id    uuid        NOT NULL,
  concept     text        NOT NULL,
  amount      numeric(12,2) NOT NULL,
  notes       text        NULL,
  created_at  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT lg_match_costs_pkey PRIMARY KEY (id),
  CONSTRAINT lg_match_costs_match_id_fkey FOREIGN KEY (match_id) REFERENCES lg_matches (id) ON DELETE CASCADE
);

CREATE INDEX idx_match_costs_match_id ON lg_match_costs(match_id);

-- ============================================================
-- RLS (mismo criterio que el resto de la migración original)
-- ============================================================
ALTER TABLE lg_matches      ENABLE ROW LEVEL SECURITY;
ALTER TABLE lg_match_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE lg_match_costs  ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lg_matches', 'lg_match_events', 'lg_match_costs']
  LOOP
    EXECUTE format('CREATE POLICY "%s_select" ON %I FOR SELECT TO authenticated USING (true)', t, t);
    EXECUTE format('CREATE POLICY "%s_insert" ON %I FOR INSERT TO authenticated WITH CHECK (true)', t, t);
    EXECUTE format('CREATE POLICY "%s_update" ON %I FOR UPDATE TO authenticated USING (true) WITH CHECK (true)', t, t);
    EXECUTE format('CREATE POLICY "%s_delete" ON %I FOR DELETE TO authenticated USING (true)', t, t);
  END LOOP;
END $$;

-- ============================================================
-- Vista: vw_tournament_standings — Tabla de posiciones
-- (idéntica a la de 20260814_lg_tournaments.sql — quedó pendiente
--  porque dependía de lg_matches.tournament_id)
-- ============================================================
CREATE OR REPLACE VIEW vw_tournament_standings AS
WITH match_rows AS (
  SELECT
    m.tournament_id,
    m.stage_id,
    m.group_name,
    m.home_club_id AS club_id,
    m.home_score    AS gf,
    m.away_score    AS gc,
    CASE WHEN m.home_score > m.away_score THEN 1 ELSE 0 END AS win,
    CASE WHEN m.home_score = m.away_score THEN 1 ELSE 0 END AS draw,
    CASE WHEN m.home_score < m.away_score THEN 1 ELSE 0 END AS loss
  FROM lg_matches m
  JOIN lg_tournament_stages s ON s.id = m.stage_id
  WHERE m.status = 'FINISHED'
    AND m.home_score IS NOT NULL
    AND m.away_score IS NOT NULL
    AND m.home_club_id IS NOT NULL
    AND (s.stage_type = 'GROUP' OR s.is_consolation = true)

  UNION ALL

  SELECT
    m.tournament_id,
    m.stage_id,
    m.group_name,
    m.away_club_id AS club_id,
    m.away_score    AS gf,
    m.home_score    AS gc,
    CASE WHEN m.away_score > m.home_score THEN 1 ELSE 0 END AS win,
    CASE WHEN m.away_score = m.home_score THEN 1 ELSE 0 END AS draw,
    CASE WHEN m.away_score < m.home_score THEN 1 ELSE 0 END AS loss
  FROM lg_matches m
  JOIN lg_tournament_stages s ON s.id = m.stage_id
  WHERE m.status = 'FINISHED'
    AND m.home_score IS NOT NULL
    AND m.away_score IS NOT NULL
    AND m.away_club_id IS NOT NULL
    AND (s.stage_type = 'GROUP' OR s.is_consolation = true)
),
aggregated AS (
  SELECT
    mr.tournament_id,
    mr.stage_id,
    mr.group_name,
    mr.club_id,
    c.name                                    AS club_name,
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
  JOIN lg_clubs c       ON c.id = mr.club_id
  JOIN lg_tournaments t ON t.id = mr.tournament_id
  GROUP BY mr.tournament_id, mr.stage_id, mr.group_name, mr.club_id, c.name,
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
