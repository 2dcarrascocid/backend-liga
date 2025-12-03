// login/crud.js
import { supabase } from './../../services/db.js';
import * as funciones from './funciones.js';

/* -----------------------------------------
   🔵 CRUD: IDENTIDADES (el_dep_identidades)
----------------------------------------- */

export async function findUserByEmail(email) {
  const { data, error } = await supabase
    .from("el_dep_identidades")
    .select("*")
    .eq("email", email)
    .single();

  if (error) return null;
  return data;
}

export async function findUserById(id) {
  const { data, error } = await supabase
    .from("el_dep_identidades")
    .select("*")
    .eq("id", id)
    .single();

  if (error) return null;
  return data;
}

export async function createUserIdentity({ email, provider, metadata }) {
  const { data, error } = await supabase
    .from("el_dep_identidades")
    .insert([{ email, provider, metadata }])
    .select()
    .single();

  if (error) throw new Error("Error creando identidad: " + error.message);
  return data;
}

export async function updateUserIdentity(id, dataToUpdate) {
  const { data, error } = await supabase
    .from("el_dep_identidades")
    .update(dataToUpdate)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error("Error actualizando usuario: " + error.message);
  return data;
}

/* -----------------------------------------
   🔐 CREDENCIALES LOCALES (password hash)
----------------------------------------- */

export async function setLocalCredentials(userId, passwordHash, salt) {
  const { data, error } = await supabase
    .from("el_dep_credenciales_locales")
    .upsert({
      usuario_id: userId,
      password_hash: passwordHash,
      password_salt: salt,
      ultimo_cambio: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error("Error guardando credenciales: " + error.message);
  return data;
}

export async function getLocalCredentials(userId) {
  const { data, error } = await supabase
    .from("el_dep_credenciales_locales")
    .select("*")
    .eq("usuario_id", userId)
    .single();

  if (error) return null;
  return data;
}

/* -----------------------------------------
   🔵 PROVEEDORES SOCIALES (OAuth)
----------------------------------------- */

export async function findOrCreateSocialIdentity({
  proveedor,
  proveedor_user_id,
  email,
  metadata,
}) {
  // Buscar si ya existe
  let { data, error } = await supabase
    .from("el_dep_proveedor_autenticacion")
    .select("*")
    .eq("proveedor", proveedor)
    .eq("proveedor_user_id", proveedor_user_id)
    .single();

  if (!error && data) return data;

  // Crear identidad nueva (solo en tabla proveedor, requiere linkeo posterior si no se pasa usuario_id)
  // Nota: Esta función es de bajo nivel. La lógica de negocio está en el handler.
  const { data: newRow, error: insertError } = await supabase
    .from("el_dep_proveedor_autenticacion")
    .insert([{ proveedor, proveedor_user_id, email, metadata }])
    .select()
    .single();

  if (insertError) throw new Error("Error creando identidad social");
  return newRow;
}

/* -----------------------------------------
   🟣 ROLES & PERMISOS
----------------------------------------- */

export async function getUserRoles(userId) {
  const { data, error } = await supabase
    .from("el_dep_usuario_roles")
    .select("rol_id, el_dep_roles(nombre)")
    .eq("usuario_id", userId);

  if (error) return []; // Si no tiene roles o error, retornar array vacío
  return data.map((r) => r.el_dep_roles.nombre);
}

export async function getUserPermissions(userId) {
  // Nota: Esto asume que existen las tablas de permisos. 
  // Si no existen en el schema actual, retornamos vacío para no romper.
  // El schema provisto NO TIENE tablas de permisos (el_dep_permisos, el_dep_roles_permisos).
  // Así que retornaremos vacío por ahora.
  return [];
}

export async function assignRoleToUser(userId, roleName) {
  // 1. Buscar ID del rol
  const { data: role, error: roleError } = await supabase
    .from("el_dep_roles")
    .select("id")
    .eq("nombre", roleName)
    .single();

  if (roleError || !role) throw new Error(`Rol '${roleName}' no encontrado`);

  // 2. Asignar
  const { data, error } = await supabase
    .from("el_dep_usuario_roles")
    .insert([{ usuario_id: userId, rol_id: role.id }])
    .select()
    .single();

  if (error) {
    // Ignorar error de duplicado
    if (error.code === '23505') return null;
    throw new Error("Error asignando rol al usuario: " + error.message);
  }

  return data;
}

/* -----------------------------------------
   🔐 SESIONES (refresh token)
----------------------------------------- */

export async function createSession(sessionData) {
  const { data, error } = await supabase
    .from("el_dep_sesiones")
    .insert([sessionData])
    .select()
    .single();

  if (error) throw new Error("Error creando sesión: " + error.message);
  return data;
}

/* -----------------------------------------
   🟢 OPERACIONES COMBINADAS
----------------------------------------- */

export async function loginLocal({ email, password }) {
  const normalizedEmail = funciones.normalizeEmail(email);

  const user = await findUserByEmail(normalizedEmail);
  if (!user) throw new Error("Usuario no encontrado");

  const credentials = await getLocalCredentials(user.id);
  if (!credentials) throw new Error("Usuario sin credenciales locales");

  const validPass = await funciones.verifyPassword(
    password,
    credentials.password_hash,
    credentials.password_salt
  );

  if (!validPass) throw new Error("Credenciales inválidas");

  return user;
}

export async function registerLocalUser({ email, password, metadata }) {
  const normalizedEmail = funciones.normalizeEmail(email);

  const existing = await findUserByEmail(normalizedEmail);
  if (existing) throw new Error("Email ya registrado");

  const user = await createUserIdentity({
    email: normalizedEmail,
    provider: "local",
    metadata,
  });

  const { hash, salt } = await funciones.hashPassword(password);

  await setLocalCredentials(user.id, hash, salt);

  await assignRoleToUser(user.id, "jugador");

  return user;
}
