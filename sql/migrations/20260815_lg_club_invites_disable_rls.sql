-- ============================================================
-- Fix: 20260815_lg_club_invites_disable_rls
-- Descripción: /auth/invite-info devuelve INVALID_INVITE para
--              invitaciones que sí existen y son válidas (verificado:
--              sha256(token) coincide exactamente con el token_hash
--              guardado, no está vencida ni usada). Mismo patrón que
--              lg_password_resets: la tabla se creó con
--              "DISABLE ROW LEVEL SECURITY" en 002_club_admins.sql,
--              pero quedó con RLS habilitada sin policies, y el
--              backend consulta con una key que en realidad tiene
--              rol "anon" (no service_role) — RLS sin policy para
--              anon devuelve vacío aunque la fila exista.
-- Fecha: 2026-08-15
-- ============================================================

ALTER TABLE public.lg_club_invites DISABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
