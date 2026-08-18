-- ============================================================
-- Migration: lg_tournaments
-- Descripción: Módulo de Torneos/Competencias — creación y
--              administración de torneos (eliminación directa,
--              todos contra todos, formatos mixtos y liguilla
--              de consuelo), fixture, logística/resultados de
--              partidos y costos por fecha y por partido.
-- Fecha: 2026-08-14
-- ============================================================

-- ============================================================
-- lg_tournaments — Torneos/Competencias
-- ============================================================
CREATE TABLE IF NOT EXISTS lg_tournaments (
  id                       uuid        NOT NULL DEFAULT gen_random_uuid(),
  org_id                   uuid        NOT NULL,
  category_id              uuid        NULL,
  name                     text        NOT NULL,
  season                   text        NULL,
  format                   text        NOT NULL DEFAULT 'ROUND_ROBIN',
  status                   text        NOT NULL DEFAULT 'DRAFT',
  start_date               date        NULL,
  end_date                 date        NULL,
  rounds_type              text        NOT NULL DEFAULT 'SINGLE',
  points_win               integer     NOT NULL DEFAULT 3,
  points_draw              integer     NOT NULL DEFAULT 1,
  points_loss              integer     NOT NULL DEFAULT 0,
  group_count              integer     NULL,
  teams_advance_per_group  integer     NULL,
  two_legged_knockout      boolean     NOT NULL DEFAULT false,
  has_third_place_match    boolean     NOT NULL DEFAULT false,
  has_consolation          boolean     NOT NULL DEFAULT false,
  consolation_name         text        NOT NULL DEFAULT 'Liguilla',
  notes                    text        NULL,
  created_at               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at               timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT lg_tournaments_pkey PRIMARY KEY (id),
  CONSTRAINT lg_tournaments_org_id_fkey FOREIGN KEY (org_id) REFERENCES lg_orgs (id) ON DELETE CASCADE,
  CONSTRAINT lg_tournaments_category_id_fkey FOREIGN KEY (category_id) REFERENCES lg_categories (id) ON DELETE SET NULL,
  CONSTRAINT lg_tournaments_format_check CHECK (format IN ('ROUND_ROBIN', 'KNOCKOUT', 'GROUPS_KNOCKOUT')),
  CONSTRAINT lg_tournaments_status_check CHECK (status IN ('DRAFT', 'REGISTRATION', 'IN_PROGRESS', 'FINISHED', 'CANCELLED')),
  CONSTRAINT lg_tournaments_rounds_type_check CHECK (rounds_type IN ('SINGLE', 'DOUBLE'))
);

CREATE INDEX IF NOT EXISTS idx_tournaments_org_id ON lg_tournaments(org_id);
CREATE INDEX IF NOT EXISTS idx_tournaments_category_id ON lg_tournaments(category_id);
CREATE INDEX IF NOT EXISTS idx_tournaments_status ON lg_tournaments(status);

-- ============================================================
-- lg_tournament_teams — Equipos inscritos en un torneo
-- ============================================================
CREATE TABLE IF NOT EXISTS lg_tournament_teams (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tournament_id  uuid        NOT NULL,
  club_id        uuid        NOT NULL,
  group_name     text        NULL,
  seed           integer     NULL,
  status         text        NOT NULL DEFAULT 'ACTIVE',
  created_at     timestamp with time zone NOT NULL DEFAULT now(),
  updated_at     timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT lg_tournament_teams_pkey PRIMARY KEY (id),
  CONSTRAINT lg_tournament_teams_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES lg_tournaments (id) ON DELETE CASCADE,
  CONSTRAINT lg_tournament_teams_club_id_fkey FOREIGN KEY (club_id) REFERENCES lg_clubs (id) ON DELETE CASCADE,
  CONSTRAINT lg_tournament_teams_status_check CHECK (status IN ('ACTIVE', 'ELIMINATED', 'WITHDRAWN', 'CHAMPION')),
  CONSTRAINT lg_tournament_teams_unique UNIQUE (tournament_id, club_id)
);

CREATE INDEX IF NOT EXISTS idx_tournament_teams_tournament_id ON lg_tournament_teams(tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournament_teams_club_id ON lg_tournament_teams(club_id);
CREATE INDEX IF NOT EXISTS idx_tournament_teams_status ON lg_tournament_teams(status);

-- ============================================================
-- lg_tournament_stages — Fases del torneo (grupos, rondas de
-- llave, liguilla de consuelo). Permite modelar formatos mixtos.
-- ============================================================
CREATE TABLE IF NOT EXISTS lg_tournament_stages (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tournament_id  uuid        NOT NULL,
  name           text        NOT NULL,
  stage_type     text        NOT NULL,
  stage_order    integer     NOT NULL DEFAULT 1,
  bracket_size   integer     NULL,
  is_consolation boolean     NOT NULL DEFAULT false,
  status         text        NOT NULL DEFAULT 'PENDING',
  created_at     timestamp with time zone NOT NULL DEFAULT now(),
  updated_at     timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT lg_tournament_stages_pkey PRIMARY KEY (id),
  CONSTRAINT lg_tournament_stages_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES lg_tournaments (id) ON DELETE CASCADE,
  CONSTRAINT lg_tournament_stages_type_check CHECK (stage_type IN ('GROUP', 'KNOCKOUT', 'CONSOLATION')),
  CONSTRAINT lg_tournament_stages_status_check CHECK (status IN ('PENDING', 'IN_PROGRESS', 'FINISHED'))
);

CREATE INDEX IF NOT EXISTS idx_tournament_stages_tournament_id ON lg_tournament_stages(tournament_id);

-- ============================================================
-- lg_matchdays — Fechas/Jornadas
-- ============================================================
CREATE TABLE IF NOT EXISTS lg_matchdays (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tournament_id  uuid        NOT NULL,
  stage_id       uuid        NULL,
  number         integer     NOT NULL,
  name           text        NULL,
  date           date        NULL,
  status         text        NOT NULL DEFAULT 'SCHEDULED',
  created_at     timestamp with time zone NOT NULL DEFAULT now(),
  updated_at     timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT lg_matchdays_pkey PRIMARY KEY (id),
  CONSTRAINT lg_matchdays_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES lg_tournaments (id) ON DELETE CASCADE,
  CONSTRAINT lg_matchdays_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES lg_tournament_stages (id) ON DELETE CASCADE,
  CONSTRAINT lg_matchdays_status_check CHECK (status IN ('SCHEDULED', 'IN_PROGRESS', 'FINISHED'))
);

CREATE INDEX IF NOT EXISTS idx_matchdays_tournament_id ON lg_matchdays(tournament_id);
CREATE INDEX IF NOT EXISTS idx_matchdays_stage_id ON lg_matchdays(stage_id);

-- ============================================================
-- lg_matches — Partidos
-- ============================================================
CREATE TABLE IF NOT EXISTS lg_matches (
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

CREATE INDEX IF NOT EXISTS idx_matches_tournament_id ON lg_matches(tournament_id);
CREATE INDEX IF NOT EXISTS idx_matches_stage_id ON lg_matches(stage_id);
CREATE INDEX IF NOT EXISTS idx_matches_matchday_id ON lg_matches(matchday_id);
CREATE INDEX IF NOT EXISTS idx_matches_status ON lg_matches(status);
CREATE INDEX IF NOT EXISTS idx_matches_home_club_id ON lg_matches(home_club_id);
CREATE INDEX IF NOT EXISTS idx_matches_away_club_id ON lg_matches(away_club_id);
CREATE INDEX IF NOT EXISTS idx_matches_home_source_match_id ON lg_matches(home_source_match_id);
CREATE INDEX IF NOT EXISTS idx_matches_away_source_match_id ON lg_matches(away_source_match_id);
CREATE INDEX IF NOT EXISTS idx_matches_venue_id ON lg_matches(venue_id);
CREATE INDEX IF NOT EXISTS idx_matches_referee_id ON lg_matches(referee_id);

-- ============================================================
-- lg_match_events — Goles, tarjetas y amonestaciones
-- ============================================================
CREATE TABLE IF NOT EXISTS lg_match_events (
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

CREATE INDEX IF NOT EXISTS idx_match_events_match_id ON lg_match_events(match_id);
CREATE INDEX IF NOT EXISTS idx_match_events_player_id ON lg_match_events(player_id);
CREATE INDEX IF NOT EXISTS idx_match_events_type ON lg_match_events(event_type);

-- ============================================================
-- lg_matchday_costs — Costos por Fecha/Jornada
-- ============================================================
CREATE TABLE IF NOT EXISTS lg_matchday_costs (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  matchday_id   uuid        NOT NULL,
  concept       text        NOT NULL,
  amount        numeric(12,2) NOT NULL,
  notes         text        NULL,
  created_at    timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT lg_matchday_costs_pkey PRIMARY KEY (id),
  CONSTRAINT lg_matchday_costs_matchday_id_fkey FOREIGN KEY (matchday_id) REFERENCES lg_matchdays (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_matchday_costs_matchday_id ON lg_matchday_costs(matchday_id);

-- ============================================================
-- lg_match_costs — Costos específicos por Partido
-- ============================================================
CREATE TABLE IF NOT EXISTS lg_match_costs (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  match_id    uuid        NOT NULL,
  concept     text        NOT NULL,
  amount      numeric(12,2) NOT NULL,
  notes       text        NULL,
  created_at  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT lg_match_costs_pkey PRIMARY KEY (id),
  CONSTRAINT lg_match_costs_match_id_fkey FOREIGN KEY (match_id) REFERENCES lg_matches (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_match_costs_match_id ON lg_match_costs(match_id);

-- ============================================================
-- Vista: vw_tournament_standings — Tabla de posiciones
-- Se calcula desde partidos FINISHED de fases de tipo GROUP o
-- de la liguilla de consuelo (is_consolation = true). Las fases
-- KNOCKOUT no generan tabla (son llave, no ranking por puntos).
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

-- ============================================================
-- RLS
-- Todos los accesos van por el backend con service_role,
-- que bypasea RLS por defecto en Supabase.
-- Se habilita RLS de todas formas para proteger accesos directos,
-- con políticas explícitas para cada operación del backend.
-- ============================================================

ALTER TABLE lg_tournaments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE lg_tournament_teams   ENABLE ROW LEVEL SECURITY;
ALTER TABLE lg_tournament_stages  ENABLE ROW LEVEL SECURITY;
ALTER TABLE lg_matchdays          ENABLE ROW LEVEL SECURITY;
ALTER TABLE lg_matches            ENABLE ROW LEVEL SECURITY;
ALTER TABLE lg_match_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE lg_matchday_costs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE lg_match_costs        ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'lg_tournaments', 'lg_tournament_teams', 'lg_tournament_stages',
    'lg_matchdays', 'lg_matches', 'lg_match_events',
    'lg_matchday_costs', 'lg_match_costs'
  ]
  LOOP
    EXECUTE format('CREATE POLICY "%s_select" ON %I FOR SELECT TO authenticated USING (true)', t, t);
    EXECUTE format('CREATE POLICY "%s_insert" ON %I FOR INSERT TO authenticated WITH CHECK (true)', t, t);
    EXECUTE format('CREATE POLICY "%s_update" ON %I FOR UPDATE TO authenticated USING (true) WITH CHECK (true)', t, t);
    EXECUTE format('CREATE POLICY "%s_delete" ON %I FOR DELETE TO authenticated USING (true)', t, t);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
