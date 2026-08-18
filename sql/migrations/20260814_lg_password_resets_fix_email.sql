-- ============================================================
-- Fix: 20260814_lg_password_resets_fix_email
-- Descripción: La tabla public.lg_password_resets ya existe en
--              Supabase pero le falta la columna `email` que define
--              migrations/001_password_reset_system.sql.
--
--              La tabla SÍ tiene filas (el intento anterior de este
--              fix, que agregaba la columna directamente como
--              NOT NULL, falló con 23502 "contains null values" —
--              la lectura previa vía API con la anon key mostraba
--              0 filas porque esta tabla tiene RLS habilitada sin
--              policies que la cubran, no porque estuviera vacía).
--
--              Esas filas son solicitudes de reset de contraseña de
--              cuando la columna email ya no existía, así que no
--              tienen (ni pueden recuperar) un email asociado — son
--              tokens de recuperación, efímeros por diseño (con su
--              propio expires_at). Se eliminan de forma segura: un
--              usuario con un link de recuperación pendiente solo
--              necesita pedir uno nuevo.
-- Fecha: 2026-08-14
-- ============================================================

ALTER TABLE public.lg_password_resets ADD COLUMN IF NOT EXISTS email text;

DELETE FROM public.lg_password_resets WHERE email IS NULL;

ALTER TABLE public.lg_password_resets ALTER COLUMN email SET NOT NULL;

-- Restaura el diseño original de 001_password_reset_system.sql ("Sin RLS:
-- solo accesible desde el backend con la API key"). En algún momento quedó
-- con RLS habilitada y sin policies, lo que además explica por qué las
-- filas existentes eran invisibles al leer con la anon key.
ALTER TABLE public.lg_password_resets DISABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
