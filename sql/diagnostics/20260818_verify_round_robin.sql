-- Verificación de "Todos contra Todos" (round robin) — solo lectura.
-- Reemplaza el UUID si quieres correrlo para otro torneo.
-- (Para pegar en el SQL Editor de Supabase: correr cada bloque por separado
--  o todo junto, cada uno devuelve su propio resultado.)

-- 1) Resumen general: equipos inscritos, jornadas, partidos totales
SELECT
  (SELECT count(*) FROM lg_tournament_teams WHERE tournament_id = 'a267ccc6-3385-40b3-a9fc-7499ae71037e') AS equipos_inscritos,
  (SELECT count(*) FROM lg_matchdays       WHERE tournament_id = 'a267ccc6-3385-40b3-a9fc-7499ae71037e') AS jornadas,
  (SELECT count(*) FROM lg_matches         WHERE tournament_id = 'a267ccc6-3385-40b3-a9fc-7499ae71037e') AS partidos_totales;

-- 2) Partidos por equipo (serie): cuántos jugó cada uno como local + visita.
--    En un todos-contra-todos IDA Y VUELTA con N equipos, cada uno debe jugar
--    2*(N-1) partidos. Con 5 equipos → 8 partidos cada uno.
SELECT
  cs.id AS series_id,
  c.name || ' — ' || cs.name AS equipo,
  count(*) FILTER (WHERE m.home_series_id = cs.id) AS como_local,
  count(*) FILTER (WHERE m.away_series_id = cs.id) AS como_visita,
  count(*) AS total_partidos
FROM lg_club_series cs
JOIN lg_clubs c ON c.id = cs.club_id
JOIN lg_matches m ON (m.home_series_id = cs.id OR m.away_series_id = cs.id)
WHERE m.tournament_id = 'a267ccc6-3385-40b3-a9fc-7499ae71037e'
GROUP BY cs.id, c.name, cs.name
ORDER BY equipo;

-- 3) Enfrentamientos por pareja: cada pareja de equipos debe aparecer 2 veces
--    si el torneo es ida y vuelta (rounds_type = DOUBLE), o 1 vez si es SINGLE.
SELECT
  LEAST(home_series_id, away_series_id)    AS equipo_a,
  GREATEST(home_series_id, away_series_id) AS equipo_b,
  count(*) AS veces_que_se_enfrentan
FROM lg_matches
WHERE tournament_id = 'a267ccc6-3385-40b3-a9fc-7499ae71037e'
GROUP BY LEAST(home_series_id, away_series_id), GREATEST(home_series_id, away_series_id)
ORDER BY veces_que_se_enfrentan DESC, equipo_a;

-- 4) Detalle completo, jornada por jornada, con nombres legibles.
SELECT
  md.number AS jornada,
  md.date,
  ch.name || ' — ' || sh.name AS local,
  cv.name || ' — ' || sv.name AS visita,
  m.status,
  m.home_score, m.away_score
FROM lg_matches m
JOIN lg_matchdays md ON md.id = m.matchday_id
JOIN lg_club_series sh ON sh.id = m.home_series_id
JOIN lg_clubs ch       ON ch.id = sh.club_id
JOIN lg_club_series sv ON sv.id = m.away_series_id
JOIN lg_clubs cv       ON cv.id = sv.club_id
WHERE m.tournament_id = 'a267ccc6-3385-40b3-a9fc-7499ae71037e'
ORDER BY md.number, m.created_at;

-- 5) Equipos inscritos que NO tienen ningún partido asignado (debería ser 0 filas).
SELECT tt.series_id, c.name || ' — ' || cs.name AS equipo_sin_partidos
FROM lg_tournament_teams tt
JOIN lg_club_series cs ON cs.id = tt.series_id
JOIN lg_clubs c        ON c.id = cs.club_id
WHERE tt.tournament_id = 'a267ccc6-3385-40b3-a9fc-7499ae71037e'
  AND NOT EXISTS (
    SELECT 1 FROM lg_matches m
    WHERE m.tournament_id = tt.tournament_id
      AND (m.home_series_id = tt.series_id OR m.away_series_id = tt.series_id)
  );
