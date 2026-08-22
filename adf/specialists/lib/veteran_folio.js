/**
 * Regla de folio veterano (clubes):
 *   - Al cumplir 55 años, el folio numérico del jugador queda libre para asignarse
 *     a otro jugador del club (no cuenta como "ocupado" en _resolveClubFolio).
 *   - El jugador conserva su mismo número pero se muestra compuesto: "D-<folio>".
 *   - Se calcula en vivo desde birth_date — no requiere columna ni cron para mantenerlo
 *     sincronizado, el estado siempre refleja la edad actual.
 *
 * El umbral y prefijo deben coincidir con frontend-liga/src/utils/folio.js.
 */

export const VETERAN_AGE_THRESHOLD = 55;
export const VETERAN_FOLIO_PREFIX = 'D';

export function computeAge(birthDate, atDate = new Date()) {
  if (!birthDate) return null;
  const birth = new Date(birthDate);
  if (Number.isNaN(birth.getTime())) return null;

  let age = atDate.getFullYear() - birth.getFullYear();
  const monthDiff = atDate.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && atDate.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

export function isVeteranByBirthDate(birthDate) {
  const age = computeAge(birthDate);
  return age !== null && age >= VETERAN_AGE_THRESHOLD;
}

export function formatClubFolio(clubFolio, birthDate) {
  if (clubFolio === null || clubFolio === undefined) return null;
  return isVeteranByBirthDate(birthDate) ? `${VETERAN_FOLIO_PREFIX}-${clubFolio}` : String(clubFolio);
}

/**
 * Devuelve { is_veteran, club_folio_display } para adjuntar a una fila de respuesta.
 */
export function decorateFolio(clubFolio, birthDate) {
  const isVeteran = isVeteranByBirthDate(birthDate);
  return {
    is_veteran: isVeteran,
    club_folio_display: formatClubFolio(clubFolio, birthDate),
  };
}
