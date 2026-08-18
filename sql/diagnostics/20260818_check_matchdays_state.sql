-- Diagnóstico de solo lectura — correr en el SQL Editor de Supabase
-- (se ejecuta como superusuario, sin RLS, para ver el estado real)

-- 1) ¿Cuántas filas hay REALMENTE para este torneo en cada tabla?
SELECT 'lg_tournament_stages' AS tabla, count(*) AS filas
FROM lg_tournament_stages WHERE tournament_id = 'a267ccc6-3385-40b3-a9fc-7499ae71037e'
UNION ALL
SELECT 'lg_matchdays', count(*)
FROM lg_matchdays WHERE tournament_id = 'a267ccc6-3385-40b3-a9fc-7499ae71037e'
UNION ALL
SELECT 'lg_matches', count(*)
FROM lg_matches WHERE tournament_id = 'a267ccc6-3385-40b3-a9fc-7499ae71037e';

-- 2) Detalle de matches: a qué stage/matchday apuntan realmente
SELECT id, stage_id, matchday_id, round_number, status, created_at
FROM lg_matches
WHERE tournament_id = 'a267ccc6-3385-40b3-a9fc-7499ae71037e'
ORDER BY created_at DESC;

-- 3) Políticas RLS vigentes en las tablas involucradas
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE tablename IN ('lg_matchdays', 'lg_matches', 'lg_tournament_stages')
ORDER BY tablename, cmd;
