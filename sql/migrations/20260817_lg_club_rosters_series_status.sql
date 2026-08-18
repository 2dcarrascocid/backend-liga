-- ============================================================
-- Migration: lg_club_rosters_series_status
-- Descripción: Agrega series_status a lg_club_rosters — estado de
--              inscripción del jugador DENTRO de la serie a la que
--              está asignado (series_id), independiente del status
--              ACTIVE/INACTIVE del roster del club (ese campo ya lo
--              usan transfers, loans y los checks de acceso al club,
--              por lo que NO se reutiliza para esto).
--
--              Al asignar un jugador a una serie (ASSIGN_PLAYER) se
--              setea series_status = 'INSCRITO'. Al desasignarlo
--              (UNASSIGN_PLAYER) se limpia junto con series_id.
--
-- Fecha: 2026-08-17
-- ============================================================

ALTER TABLE lg_club_rosters ADD COLUMN IF NOT EXISTS series_status text NULL;

NOTIFY pgrst, 'reload schema';
