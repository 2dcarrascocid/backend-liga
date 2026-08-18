-- ============================================================
-- Migration: lg_club_series_add_fields
-- Descripción: Agrega a lg_club_series los datos clave que debe
--              tener toda serie de un club:
--                - description:      detalle libre de la serie
--                - min_age:          edad que parametriza la serie
--                - age_restriction:  modo de cálculo de elegibilidad
--                                    por edad de los jugadores:
--                                    true  ("Sí")  -> el jugador debe
--                                          tener los años CUMPLIDOS
--                                          (edad real) >= min_age
--                                    false ("No")  -> elegibilidad por
--                                          AÑO DE NACIMIENTO: puede
--                                          jugar todo jugador nacido
--                                          en o antes del año que
--                                          resulta de parametrizar
--                                          min_age (categoría por año,
--                                          sin exigir cumpleaños).
--
-- Fecha: 2026-08-17
-- ============================================================

ALTER TABLE lg_club_series ADD COLUMN IF NOT EXISTS description   text    NULL;
ALTER TABLE lg_club_series ADD COLUMN IF NOT EXISTS min_age       smallint NULL;
ALTER TABLE lg_club_series ADD COLUMN IF NOT EXISTS age_restriction boolean NOT NULL DEFAULT false;

ALTER TABLE lg_club_series DROP CONSTRAINT IF EXISTS lg_club_series_min_age_check;
ALTER TABLE lg_club_series
  ADD CONSTRAINT lg_club_series_min_age_check CHECK (min_age IS NULL OR min_age BETWEEN 1 AND 100);

NOTIFY pgrst, 'reload schema';
