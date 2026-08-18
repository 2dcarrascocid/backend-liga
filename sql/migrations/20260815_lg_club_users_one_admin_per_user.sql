-- ============================================================
-- Fix: 20260815_lg_club_users_one_admin_per_user
-- Descripción: Regla de negocio — un usuario solo puede ser
--              ADMIN_CLUB de un club a la vez (un email = un club).
--              Índice único parcial: no afecta otros roles que
--              pudiera tener lg_club_users.role en el futuro, solo
--              restringe ADMIN_CLUB a una fila por user_id.
--              lg_club_users está confirmada vacía (sesión 2026-08-14),
--              migración segura sin riesgo de conflicto con datos
--              existentes.
-- Fecha: 2026-08-15
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_club_users_admin_club_one_per_user
  ON lg_club_users (user_id)
  WHERE role = 'ADMIN_CLUB';

NOTIFY pgrst, 'reload schema';
