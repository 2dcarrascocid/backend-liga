-- ============================================================
-- Migration: unify_rls_all_tables
-- Descripción: El backend usa una única clave para hablar con Supabase
--              cuyo rol real es 'anon' (no 'authenticated' ni
--              'service_role'). La mayoría de las tablas "funcionan"
--              hoy porque tienen RLS deshabilitado por drift (nunca
--              quedó aplicado como decían las migraciones originales).
--              lg_matchdays y lg_matches son la excepción: ahí SÍ quedó
--              RLS activo, con políticas limitadas a 'authenticated',
--              por lo que el rol 'anon' queda bloqueado (insert/select)
--              — de ahí que jornadas y partidos no se vean.
--
--              Este script iguala el criterio en TODAS las tablas de la
--              app: RLS habilitado + políticas permisivas para 'anon' Y
--              'authenticated' (la autorización real ya la hace el
--              código de cada Specialist vía assertClubAccess() /
--              assertOrgAccess() antes de tocar la base — RLS aquí es
--              solo una capa extra, no la barrera principal).
--
-- Nota: es idempotente. Se puede correr las veces que haga falta.
-- Fecha: 2026-08-18
-- ============================================================

DO $$
DECLARE
  t text;
  pol record;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'lg_categories', 'lg_club_invites', 'lg_club_rosters', 'lg_club_series',
    'lg_club_users', 'lg_clubs', 'lg_match_costs', 'lg_match_events',
    'lg_matchday_costs', 'lg_matchdays', 'lg_matches', 'lg_org_users',
    'lg_orgs', 'lg_password_resets', 'lg_player_documents', 'lg_player_loans',
    'lg_players', 'lg_referees', 'lg_sports', 'lg_tournament_stages',
    'lg_tournament_teams', 'lg_tournaments', 'lg_transfers',
    'lg_venue_availability', 'lg_venue_bookings', 'lg_venues'
  ]
  LOOP
    -- Defensivo: si alguna tabla no existe en esta base, se salta sin fallar
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN

      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

      -- Elimina TODAS las políticas existentes en la tabla, sin importar
      -- su nombre — así no queda ninguna política "fantasma" de drift.
      FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pol.policyname, t);
      END LOOP;

      -- Política uniforme: mismo criterio para todas las tablas.
      EXECUTE format('CREATE POLICY "%s_select" ON %I FOR SELECT TO anon, authenticated USING (true)', t, t);
      EXECUTE format('CREATE POLICY "%s_insert" ON %I FOR INSERT TO anon, authenticated WITH CHECK (true)', t, t);
      EXECUTE format('CREATE POLICY "%s_update" ON %I FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true)', t, t);
      EXECUTE format('CREATE POLICY "%s_delete" ON %I FOR DELETE TO anon, authenticated USING (true)', t, t);

    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
