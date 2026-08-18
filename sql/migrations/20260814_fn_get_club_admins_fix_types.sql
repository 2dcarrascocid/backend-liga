-- ============================================================
-- Fix: 20260814_fn_get_club_admins_fix_types
-- Descripción: fn_get_club_admins (definida en migrations/002_club_admins.sql)
--              falla con "structure of query does not match function
--              result type" — el SELECT interno no castea explícitamente
--              a los tipos declarados en RETURNS TABLE, y alguna columna
--              real (probablemente lg_club_users.role si es un enum, o
--              created_at si no es timestamptz) no matchea exacto.
--
--              Redefine la función casteando cada columna al tipo
--              declarado, sin importar el tipo real subyacente. Operación
--              no destructiva (solo redefine la función, no toca datos).
-- Fecha: 2026-08-14
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_get_club_admins(p_club_id uuid)
RETURNS TABLE(user_id uuid, email text, role text, assigned_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public
AS $$
BEGIN
  RETURN QUERY
  SELECT  cu.user_id::uuid,
          u.email::text,
          cu.role::text,
          cu.created_at::timestamptz AS assigned_at
  FROM    public.lg_club_users cu
  JOIN    auth.users u ON u.id = cu.user_id
  WHERE   cu.club_id   = p_club_id
    AND   cu.role::text = 'ADMIN_CLUB'
    AND   u.deleted_at IS NULL
  ORDER BY cu.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_club_admins(uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
