/**
 * ADF - Auth Specialist (Specialists Layer)
 *
 * Ejecuta operaciones del dominio de autenticación.
 * Encapsula la lógica de negocio de auth: login local, OAuth, bootstrap.
 *
 * DO:
 *   - Operar exclusivamente sobre tablas de auth y lg_orgs, lg_org_users
 *   - Retornar siempre el session object completo en LOGIN operations
 *   - Incluir membresías de org en la respuesta de login
 *
 * DON'T:
 *   - No acceder a tablas de clubs o players
 *   - No generar tokens JWT propios — usar Supabase auth
 *   - No lanzar excepciones no controladas
 *
 * Capabilities: LOGIN_LOCAL | LOGIN_GOOGLE | LOGIN_FACEBOOK | BOOTSTRAP
 *
 * Checklist:
 *   [ ] ¿Se retorna session.access_token y session.refresh_token?
 *   [ ] ¿Se incluyen las orgs del usuario en la respuesta?
 *   [ ] ¿Se maneja el caso de usuario sin org?
 *   [ ] ¿Se maneja la migración de usuarios legacy (bcrypt)?
 */

import { Skill } from '../contracts/skill_contract.js';
import { createSkillResult } from '../contracts/task_schema.js';
import bcrypt from 'bcryptjs';

const SPORTS_CATALOG = [
  { name: 'Futbol', slug: 'futbol' },
  { name: 'Basketball', slug: 'basketball' },
  { name: 'Tennis', slug: 'tennis' },
  { name: 'Volleyball', slug: 'volleyball' },
];

function generateSlug(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

async function getOrgMemberships(db, userId) {
  const { data } = await db
    .from('lg_org_users')
    .select('role, lg_orgs(id, name, slug, country_code)')
    .eq('user_id', userId);

  return (data || []).map(row => ({
    role: row.role,
    org: row.lg_orgs,
  }));
}

export class AuthSpecialist extends Skill {
  constructor() {
    super('auth_specialist', '1.0.0');
    this.domain = 'auth';
    this.capabilities = ['LOGIN_LOCAL', 'LOGIN_GOOGLE', 'LOGIN_FACEBOOK', 'BOOTSTRAP'];

    this.contract = {
      input: [
        { name: 'operation', required: true, type: 'string', description: 'Capability a ejecutar' },
        { name: 'payload', required: true, type: 'object', description: 'Datos de la operación' },
        { name: 'supabase', required: true, type: 'object', description: 'Cliente Supabase (admin)' },
        { name: 'userId', required: false, type: 'string', description: 'ID del usuario autenticado (para BOOTSTRAP)' },
      ],
      output: [
        { name: 'session', type: 'object', description: 'Sesión Supabase (access_token, refresh_token)' },
        { name: 'user', type: 'object', description: 'Datos del usuario' },
        { name: 'orgs', type: 'array', description: 'Membresías de orgs del usuario' },
        { name: 'org', type: 'object', description: 'Org creada (solo en BOOTSTRAP)' },
      ],
      rules: {
        do: [
          'Incluir membresías de org en todas las respuestas de login',
          'Usar signInWithPassword() de Supabase para login local',
          'Migrar contraseñas bcrypt legacy al detectarlas',
        ],
        dont: [
          'No generar JWT manualmente',
          'No acceder a tablas fuera del dominio auth/orgs',
        ],
      },
      checklist: [
        'session.access_token incluido en respuesta',
        'orgs del usuario incluidas en respuesta',
        'Errores de Supabase capturados y mapeados',
        'Migración legacy manejada correctamente',
      ],
    };
  }

  async execute(task) {
    const { operation, payload, supabase, userId } = task.input;

    if (!this.capabilities.includes(operation)) {
      return createSkillResult({
        success: false,
        errorCode: 'UNKNOWN_OPERATION',
        errorMessage: `Operación desconocida: "${operation}". Disponibles: ${this.capabilities.join(', ')}`,
      });
    }

    try {
      switch (operation) {
        case 'LOGIN_LOCAL':    return this._loginLocal(payload, supabase);
        case 'LOGIN_GOOGLE':   return this._loginOAuth(payload, supabase, 'google');
        case 'LOGIN_FACEBOOK': return this._loginOAuth(payload, supabase, 'facebook');
        case 'BOOTSTRAP':      return this._bootstrap(payload, supabase, userId);
      }
    } catch (err) {
      return createSkillResult({
        success: false,
        errorCode: 'AUTH_SPECIALIST_ERROR',
        errorMessage: err.message,
      });
    }
  }

  async _loginLocal({ email, password }, supabase) {
    // Try standard Supabase auth first
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (!error && data?.session) {
      const orgs = await getOrgMemberships(supabase, data.user.id);
      return createSkillResult({
        success: true,
        data: { session: data.session, user: data.user, orgs },
      });
    }

    // Legacy user migration: check bcrypt password in auth.users
    if (error?.message?.toLowerCase().includes('invalid')) {
      const { data: legacyUser } = await supabase
        .from('auth.users')
        .select('id, encrypted_password')
        .eq('email', email)
        .maybeSingle();

      if (legacyUser?.encrypted_password) {
        const isValid = await bcrypt.compare(password, legacyUser.encrypted_password);
        if (isValid) {
          // Migrate: update password in Supabase auth
          await supabase.auth.admin.updateUserById(legacyUser.id, { password });
          const { data: migrated, error: migErr } = await supabase.auth.signInWithPassword({ email, password });
          if (!migErr && migrated?.session) {
            const orgs = await getOrgMemberships(supabase, migrated.user.id);
            return createSkillResult({
              success: true,
              data: { session: migrated.session, user: migrated.user, orgs, migrated: true },
            });
          }
        }
      }
    }

    return createSkillResult({
      success: false,
      errorCode: 'INVALID_CREDENTIALS',
      errorMessage: 'Email o contraseña incorrectos',
    });
  }

  async _loginOAuth({ idToken }, supabase, provider) {
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider,
      token: idToken,
    });

    if (error || !data?.session) {
      return createSkillResult({
        success: false,
        errorCode: 'OAUTH_FAILED',
        errorMessage: error?.message || `Error en login con ${provider}`,
      });
    }

    const orgs = await getOrgMemberships(supabase, data.user.id);
    return createSkillResult({
      success: true,
      data: { session: data.session, user: data.user, orgs },
    });
  }

  async _bootstrap({ orgName, countryCode }, supabase, userId) {
    if (!userId) {
      return createSkillResult({
        success: false,
        errorCode: 'AUTH_REQUIRED',
        errorMessage: 'Bootstrap requiere usuario autenticado',
      });
    }

    const slug = generateSlug(orgName);

    // Create org
    const { data: org, error: orgErr } = await supabase
      .from('lg_orgs')
      .insert({ name: orgName, slug, country_code: countryCode })
      .select()
      .single();

    if (orgErr) {
      return createSkillResult({
        success: false,
        errorCode: 'ORG_CREATE_FAILED',
        errorMessage: orgErr.message,
      });
    }

    // Assign user as ADMIN
    await supabase
      .from('lg_org_users')
      .insert({ org_id: org.id, user_id: userId, role: 'ADMIN' });

    // Seed sports catalog (ignore duplicates)
    const sportsWithOrg = SPORTS_CATALOG.map(s => ({ ...s, org_id: org.id }));
    await supabase.from('lg_sports').upsert(sportsWithOrg, { ignoreDuplicates: true });

    return createSkillResult({
      success: true,
      data: { org, role: 'ADMIN' },
    });
  }
}
