-- ─────────────────────────────────────────────────────────────────────────────
-- 002_club_admins.sql
-- Ejecutar en: Supabase → SQL Editor → New query → Run
-- Requiere que 001_password_reset_system.sql ya esté ejecutado.
-- ─────────────────────────────────────────────────────────────────────────────

-- Tabla de invitaciones a admin-club
CREATE TABLE IF NOT EXISTS public.lg_club_invites (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  email       text        NOT NULL,
  club_id     uuid        NOT NULL,
  invited_by  uuid        NOT NULL,
  token_hash  text        NOT NULL UNIQUE,
  user_id     uuid,          -- se rellena si el usuario ya existía al invitar
  accepted_at timestamptz,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lg_club_invites_club_idx  ON public.lg_club_invites (club_id);
CREATE INDEX IF NOT EXISTS lg_club_invites_email_idx ON public.lg_club_invites (email);

ALTER TABLE public.lg_club_invites DISABLE ROW LEVEL SECURITY;

-- ── fn_invite_club_admin ──────────────────────────────────────────────────────
-- Token generado en JS (crypto.randomBytes) — no requiere pgcrypto.
-- Recibe token_hash y expires_at pre-calculados.
-- Retorna: { is_new, user_id }
CREATE OR REPLACE FUNCTION public.fn_invite_club_admin(
  p_email      text,
  p_club_id    uuid,
  p_inviter_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE lower(email) = lower(p_email) AND deleted_at IS NULL
  LIMIT 1;

  -- Limpiar invitaciones previas pendientes para este email+club
  DELETE FROM public.lg_club_invites
  WHERE lower(email) = lower(p_email) AND club_id = p_club_id AND accepted_at IS NULL;

  INSERT INTO public.lg_club_invites (email, club_id, invited_by, token_hash, user_id, expires_at)
  VALUES (lower(p_email), p_club_id, p_inviter_id, p_token_hash, v_user_id, p_expires_at);

  -- Si ya existe → asignar rol de inmediato
  IF v_user_id IS NOT NULL THEN
    INSERT INTO public.lg_club_users (club_id, user_id, role)
    VALUES (p_club_id, v_user_id, 'ADMIN_CLUB')
    ON CONFLICT (club_id, user_id) DO UPDATE SET role = 'ADMIN_CLUB';
  END IF;

  RETURN jsonb_build_object(
    'is_new',  v_user_id IS NULL,
    'user_id', v_user_id
  );
END;
$$;

-- ── fn_get_club_admins ────────────────────────────────────────────────────────
-- Retorna usuarios con rol ADMIN_CLUB de un club, incluyendo su email.
CREATE OR REPLACE FUNCTION public.fn_get_club_admins(p_club_id uuid)
RETURNS TABLE(user_id uuid, email text, role text, assigned_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public
AS $$
BEGIN
  RETURN QUERY
  SELECT  cu.user_id,
          u.email,
          cu.role,
          cu.created_at AS assigned_at
  FROM    public.lg_club_users cu
  JOIN    auth.users u ON u.id = cu.user_id
  WHERE   cu.club_id   = p_club_id
    AND   cu.role      = 'ADMIN_CLUB'
    AND   u.deleted_at IS NULL
  ORDER BY cu.created_at DESC;
END;
$$;

-- ── fn_accept_club_invite ─────────────────────────────────────────────────────
-- Acepta una invitación: asigna ADMIN_CLUB y marca el invite como aceptado.
-- Recibe p_token_hash pre-calculado en JS con SHA-256.
CREATE OR REPLACE FUNCTION public.fn_accept_club_invite(p_token_hash text, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public
AS $$
DECLARE
  v_record public.lg_club_invites%ROWTYPE;
BEGIN
  SELECT * INTO v_record
  FROM public.lg_club_invites
  WHERE token_hash = p_token_hash AND expires_at > now() AND accepted_at IS NULL
  LIMIT 1;

  IF v_record.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_INVITE');
  END IF;

  INSERT INTO public.lg_club_users (club_id, user_id, role)
  VALUES (v_record.club_id, p_user_id, 'ADMIN_CLUB')
  ON CONFLICT (club_id, user_id) DO UPDATE SET role = 'ADMIN_CLUB';

  UPDATE public.lg_club_invites
  SET accepted_at = now(), user_id = p_user_id
  WHERE id = v_record.id;

  RETURN jsonb_build_object('success', true, 'club_id', v_record.club_id);
END;
$$;

-- ── Permisos ──────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.fn_invite_club_admin(text, uuid, uuid, text, timestamptz) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_get_club_admins(uuid)                                  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_accept_club_invite(text, uuid)                         TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
