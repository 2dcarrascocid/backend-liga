/**
 * Bracket Propagation (helper con acceso a DB)
 *
 * Cuando un partido de una llave de eliminación directa termina,
 * su ganador (o perdedor, para el partido por el 3er lugar) debe
 * avanzar automáticamente al partido siguiente. Esto se resuelve
 * de forma genérica siguiendo los punteros `home_source_match_id` /
 * `away_source_match_id` que dejó `fixture_generator.js` al crear
 * el cuadro — sin necesidad de una tabla de "bracket" aparte.
 *
 * Se usa tanto al generar byes (partidos WALKOVER ya resueltos al
 * crear el fixture) como al registrar el resultado de un partido
 * real desde matches_specialist. El "equipo" que avanza es una
 * Serie (lg_club_series), no un Club directamente.
 */

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 * @param {{ id: string, home_series_id: string|null, away_series_id: string|null, winner_series_id: string|null }} match
 */
export async function propagateWinner(db, match) {
  if (!match?.winner_series_id) return;

  const loserSeriesId =
    match.winner_series_id === match.home_series_id ? match.away_series_id : match.home_series_id;
  const now = new Date().toISOString();

  const { data: homeTargets } = await db
    .from('lg_matches')
    .select('id, home_source_is_loser')
    .eq('home_source_match_id', match.id);

  for (const target of homeTargets || []) {
    const value = target.home_source_is_loser ? loserSeriesId : match.winner_series_id;
    if (value) {
      await db.from('lg_matches').update({ home_series_id: value, updated_at: now }).eq('id', target.id);
    }
  }

  const { data: awayTargets } = await db
    .from('lg_matches')
    .select('id, away_source_is_loser')
    .eq('away_source_match_id', match.id);

  for (const target of awayTargets || []) {
    const value = target.away_source_is_loser ? loserSeriesId : match.winner_series_id;
    if (value) {
      await db.from('lg_matches').update({ away_series_id: value, updated_at: now }).eq('id', target.id);
    }
  }
}
