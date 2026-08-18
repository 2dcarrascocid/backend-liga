-- ============================================================
-- Fix: lg_matchdays_matches_fix_rls
-- Descripción: GENERATE_FIXTURE falla con "new row violates row-level
--              security policy for table lg_matchdays" al insertar
--              jornadas, aunque el código de la política es idéntico
--              al de lg_tournament_stages (que sí inserta bien) y
--              ambas nacieron del mismo bloque DO en
--              20260814_lg_tournaments.sql. Esto es drift entre la
--              migración documentada y el estado real de la tabla en
--              Supabase (ver memoria del proyecto sobre lg_matches y
--              lg_password_resets) — la política vigente no coincide
--              con la que debería existir.
--
--              Este script recrea, de forma idempotente, las políticas
--              de lg_matchdays y lg_matches (esta última no llegó a
--              probarse porque el insert de matchdays falla primero,
--              así que se corrige preventivamente con el mismo patrón).
--
-- Fecha: 2026-08-18
-- ============================================================

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lg_matchdays', 'lg_matches']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%s_select" ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%s_insert" ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%s_update" ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%s_delete" ON %I', t, t);

    EXECUTE format('CREATE POLICY "%s_select" ON %I FOR SELECT TO authenticated USING (true)', t, t);
    EXECUTE format('CREATE POLICY "%s_insert" ON %I FOR INSERT TO authenticated WITH CHECK (true)', t, t);
    EXECUTE format('CREATE POLICY "%s_update" ON %I FOR UPDATE TO authenticated USING (true) WITH CHECK (true)', t, t);
    EXECUTE format('CREATE POLICY "%s_delete" ON %I FOR DELETE TO authenticated USING (true)', t, t);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
