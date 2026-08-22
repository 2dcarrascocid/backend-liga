-- ============================================================
-- Script: reset_tournaments_fixtures_data
-- ⚠️  DESTRUCTIVO — NO es una migración de esquema, es un borrado
--     de datos. Ejecutar manualmente en el SQL Editor de Supabase
--     solo cuando se quiera dejar el módulo de Torneos en blanco
--     (ej: para reiniciar pruebas después de reestructurar
--     Temporadas/tipo de torneo).
--
-- Qué borra (todo el árbol de un torneo, en cascada):
--   lg_tournaments, lg_tournament_teams, lg_tournament_stages,
--   lg_matchdays, lg_matches, lg_match_events,
--   lg_matchday_costs, lg_match_costs
--
-- Qué NO toca (a propósito):
--   lg_seasons, lg_clubs, lg_club_series, lg_players,
--   lg_club_rosters, lg_categories, lg_venues, lg_referees
--   — nada del maestro de clubes/jugadores/series se ve afectado,
--   solo se vacía la competencia (torneos y su fixture).
--
-- lg_match_costs/lg_matchday_costs no tienen tournament_id directo
-- (cuelgan de lg_matches/lg_matchdays respectivamente), por eso se
-- listan explícitamente en vez de confiar solo en el CASCADE.
--
-- Es idempotente: correrlo sobre tablas ya vacías no falla.
-- Fecha: 2026-08-21
-- ============================================================

TRUNCATE TABLE
  lg_match_costs,
  lg_matchday_costs,
  lg_match_events,
  lg_matches,
  lg_matchdays,
  lg_tournament_stages,
  lg_tournament_teams,
  lg_tournaments
CASCADE;
