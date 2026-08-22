/**
 * Club Access (helper compartido, sin estado)
 *
 * Centraliza la regla de autorización de "administrador de club":
 *   - Un ADMIN de la organización tiene acceso a todos los clubes de su org.
 *   - Un ADMIN_CLUB solo tiene acceso al club específico donde fue aceptado
 *     como administrador (ver auth_specialist.js::_acceptClubInvite).
 *
 * Reemplaza el `_assertClubAccess` que antes vivía duplicado dentro de
 * players_specialist.js — cualquier specialist que opere sobre un club
 * (clubs, players, club_series) debe usar este helper en vez de reimplementar
 * la misma consulta.
 */

/**
 * Verifica que `userId` tenga acceso de administración sobre `clubId`.
 * @returns {Promise<string|null>} código de error ('CLUB_NOT_FOUND' | 'FORBIDDEN') o null si tiene acceso
 */
export async function assertClubAccess(clubId, userId, db) {
  if (!userId) return 'FORBIDDEN';

  const { data: club } = await db.from('lg_clubs').select('org_id').eq('id', clubId).single();
  if (!club) return 'CLUB_NOT_FOUND';

  const [{ data: orgAdmin }, { data: clubAdmin }] = await Promise.all([
    db.from('lg_org_users').select('role')
      .eq('user_id', userId).eq('org_id', club.org_id).maybeSingle(),
    db.from('lg_club_users').select('role')
      .eq('user_id', userId).eq('club_id', clubId).eq('role', 'ADMIN_CLUB').maybeSingle(),
  ]);

  if (orgAdmin?.role === 'ADMIN' || clubAdmin?.role === 'ADMIN_CLUB') return null;
  return 'FORBIDDEN';
}

/**
 * Verifica si `userId` es ADMIN de la organización `orgId` (no basta con
 * ser ADMIN_CLUB de algún club de esa org). Útil cuando una regla de negocio
 * distingue explícitamente "admin de org" de "admin de club" (ej: reglas de
 * inscripción a torneos), a diferencia de assertClubAccess() que solo dice
 * si hay acceso o no, sin decir por cuál de los dos motivos.
 * @returns {Promise<boolean>}
 */
export async function isOrgAdmin(userId, orgId, db) {
  if (!userId || !orgId) return false;

  const { data: orgAdmin } = await db
    .from('lg_org_users').select('role')
    .eq('user_id', userId).eq('org_id', orgId).maybeSingle();

  return orgAdmin?.role === 'ADMIN';
}

/**
 * Resuelve qué clubes puede ver/administrar `userId` dentro de `orgId`.
 * @returns {Promise<'ALL'|string[]>} 'ALL' si es ADMIN de la org, o el array
 *   de club_ids donde es ADMIN_CLUB (puede ser vacío).
 */
export async function getAccessibleClubIds(userId, orgId, db) {
  if (!userId) return [];

  const { data: orgAdmin } = await db
    .from('lg_org_users').select('role')
    .eq('user_id', userId).eq('org_id', orgId).maybeSingle();

  if (orgAdmin?.role === 'ADMIN') return 'ALL';

  const { data: clubRows } = await db
    .from('lg_club_users')
    .select('club_id, lg_clubs!inner(org_id)')
    .eq('user_id', userId)
    .eq('role', 'ADMIN_CLUB')
    .eq('lg_clubs.org_id', orgId);

  return (clubRows || []).map((r) => r.club_id);
}
