-- Diagnóstico de solo lectura: pertenencia de roles y TODAS las políticas
-- (sin filtrar por nombre, para detectar políticas duplicadas/huérfanas)

-- 1) ¿'anon' es miembro de 'authenticated' (o viceversa)?
SELECT r.rolname AS rol, r2.rolname AS es_miembro_de
FROM pg_auth_members m
JOIN pg_roles r  ON r.oid = m.member
JOIN pg_roles r2 ON r2.oid = m.roleid
WHERE r.rolname IN ('anon', 'authenticated', 'service_role')
   OR r2.rolname IN ('anon', 'authenticated', 'service_role');

-- 2) TODAS las políticas de lg_matchdays y lg_matches, sin filtrar
--    (para ver si hay más de 4 por tabla = política duplicada/huérfana)
SELECT tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE tablename IN ('lg_matchdays', 'lg_matches')
ORDER BY tablename, policyname;

-- 3) ¿RLS está realmente habilitado (y forzado) en estas tablas?
SELECT relname AS tabla, relrowsecurity AS rls_habilitado, relforcerowsecurity AS rls_forzado
FROM pg_class
WHERE relname IN ('lg_matchdays', 'lg_matches', 'lg_tournament_stages');

-- 4) GRANTs de nivel tabla (separado de RLS) — ¿anon/authenticated tienen
--    privilegio SELECT/INSERT base sobre estas tablas?
SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_name IN ('lg_matchdays', 'lg_matches', 'lg_tournament_stages')
  AND grantee IN ('anon', 'authenticated', 'public')
ORDER BY table_name, grantee, privilege_type;
