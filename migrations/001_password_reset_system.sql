-- ─────────────────────────────────────────────────────────────────────────────
-- 001_password_reset_system.sql
-- Ejecutar en: Supabase → SQL Editor → New query → Run
--
-- Solo necesitamos UNA función SQL (para escribir en auth.users).
-- Toda la lógica de tokens es JavaScript puro en el backend.
-- ─────────────────────────────────────────────────────────────────────────────

-- Tabla para guardar los tokens de recuperación
CREATE TABLE IF NOT EXISTS public.lg_password_resets (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  email       text        NOT NULL,
  token_hash  text        NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Sin RLS: solo accesible desde el backend con la API key
ALTER TABLE public.lg_password_resets DISABLE ROW LEVEL SECURITY;

-- Única función: actualiza encrypted_password en auth.users
-- SECURITY DEFINER es necesario porque auth.users no es accesible con anon key
CREATE OR REPLACE FUNCTION public.fn_update_password_by_email(
  p_email         text,
  p_password_hash text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public
AS $$
DECLARE
  v_rows integer;
BEGIN
  UPDATE auth.users
  SET encrypted_password = p_password_hash,
      updated_at         = now()
  WHERE lower(email) = lower(p_email)
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_update_password_by_email(text, text) TO anon, authenticated;

-- Recarga el caché de PostgREST para que detecte la nueva función
NOTIFY pgrst, 'reload schema';
