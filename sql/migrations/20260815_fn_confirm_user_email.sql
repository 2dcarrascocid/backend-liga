-- ============================================================
-- Fix: 20260815_fn_confirm_user_email
-- Descripción: Las cuentas creadas vía supabase.auth.signUp() en
--              _acceptClubInvite (auth_specialist.js) quedan con
--              email_confirmed_at = NULL, así que signInWithPassword
--              las rechaza con "Invalid login credentials" (mostrado
--              genéricamente como INVALID_CREDENTIALS) aunque la
--              contraseña sea correcta.
--
--              Como el email ya fue validado por el ADMIN de la
--              organización al invitarlo, se confirma automáticamente
--              al aceptar la invitación. No se puede usar la Admin API
--              de Supabase (auth.admin.*) porque la key "service role"
--              del backend en realidad tiene rol anon — se resuelve
--              igual que fn_update_password_by_email / fn_invite_club_admin:
--              una función SECURITY DEFINER que opera sobre auth.users
--              sin depender del rol de quien la invoca.
-- Fecha: 2026-08-15
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_confirm_user_email(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public
AS $$
DECLARE
  v_rows integer;
BEGIN
  UPDATE auth.users
  SET email_confirmed_at = COALESCE(email_confirmed_at, now()),
      updated_at         = now()
  WHERE id = p_user_id
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_confirm_user_email(uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
