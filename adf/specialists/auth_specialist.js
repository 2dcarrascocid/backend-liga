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
import crypto from 'crypto';
import { sendPasswordResetEmail } from '../../utils/mailer.js';
import dotenv from 'dotenv';

dotenv.config();

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
    this.capabilities = ['LOGIN_LOCAL', 'LOGIN_GOOGLE', 'LOGIN_FACEBOOK', 'BOOTSTRAP', 'FORGOT_PASSWORD', 'RESET_PASSWORD', 'INVITE_INFO', 'ACCEPT_CLUB_INVITE'];

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
        case 'LOGIN_LOCAL':      return this._loginLocal(payload, supabase);
        case 'LOGIN_GOOGLE':     return this._loginOAuth(payload, supabase, 'google');
        case 'LOGIN_FACEBOOK':   return this._loginOAuth(payload, supabase, 'facebook');
        case 'BOOTSTRAP':        return this._bootstrap(payload, supabase, userId);
        case 'FORGOT_PASSWORD':    return this._forgotPassword(payload, supabase);
        case 'RESET_PASSWORD':     return this._resetPassword(payload, supabase);
        case 'INVITE_INFO':        return this._inviteInfo(payload, supabase);
        case 'ACCEPT_CLUB_INVITE': return this._acceptClubInvite(payload, supabase);
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
        .schema('auth')
        .from('users')
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

  async _forgotPassword({ email }, supabase) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

    // Token: 32 bytes aleatorios → 64 hex chars (puro Node.js, sin SQL)
    const token     = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hora

    // Eliminar tokens pendientes anteriores del mismo email
    await supabase
      .from('lg_password_resets')
      .delete()
      .eq('email', email.toLowerCase())
      .is('used_at', null);

    // Guardar nuevo token (solo el hash, nunca el token plano)
    const { error: insertError } = await supabase
      .from('lg_password_resets')
      .insert({ email: email.toLowerCase(), token_hash: tokenHash, expires_at: expiresAt });

    if (insertError) {
      // Tabla no existe todavía — registrar pero no fallar con el usuario
      console.error('lg_password_resets insert error:', insertError.message, '— ¿Ejecutaste migrations/001_password_reset_system.sql?');
    } else {
      const resetLink = `${frontendUrl}/reset-password?token=${token}`;
      try {
        await sendPasswordResetEmail(email, resetLink);
      } catch (mailErr) {
        console.error('SMTP error:', mailErr.message);
      }
    }

    return createSkillResult({
      success: true,
      data: { message: 'Si el email está registrado, recibirás un enlace de recuperación.' },
    });
  }

  async _resetPassword({ token, newPassword }, supabase) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const now       = new Date().toISOString();

    // Buscar token válido en la tabla (puro JS + Supabase client)
    const { data: record, error: lookupError } = await supabase
      .from('lg_password_resets')
      .select('id, email')
      .eq('token_hash', tokenHash)
      .is('used_at', null)
      .gt('expires_at', now)
      .maybeSingle();

    if (lookupError || !record) {
      return createSkillResult({
        success: false,
        errorCode: 'INVALID_OR_EXPIRED_TOKEN',
        errorMessage: 'El enlace de recuperación es inválido o ha expirado. Solicita uno nuevo.',
      });
    }

    // Hash bcrypt en JS, luego la función SQL actualiza auth.users
    const passwordHash = await bcrypt.hash(newPassword, 12);

    const { data: updated, error: updateError } = await supabase.rpc(
      'fn_update_password_by_email',
      { p_email: record.email, p_password_hash: passwordHash }
    );

    if (updateError) {
      console.error('fn_update_password_by_email error:', updateError.message, '— ¿Ejecutaste migrations/001_password_reset_system.sql?');
      return createSkillResult({
        success: false,
        errorCode: 'PASSWORD_UPDATE_FAILED',
        errorMessage: 'Error al actualizar la contraseña. Intenta nuevamente.',
      });
    }

    if (!updated) {
      return createSkillResult({
        success: false,
        errorCode: 'USER_NOT_FOUND',
        errorMessage: 'No se encontró el usuario asociado a este enlace.',
      });
    }

    // Marcar token como usado
    await supabase
      .from('lg_password_resets')
      .update({ used_at: now })
      .eq('id', record.id);

    return createSkillResult({
      success: true,
      data: { message: 'Contraseña actualizada exitosamente. Ya puedes iniciar sesión.' },
    });
  }

  async _inviteInfo({ token }, supabase) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const { data: invite } = await supabase
      .from('lg_club_invites')
      .select('email, club_id, user_id, expires_at, accepted_at')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (!invite) {
      return createSkillResult({ success: false, errorCode: 'INVALID_INVITE', errorMessage: 'Invitación inválida o expirada.' });
    }
    if (invite.accepted_at) {
      return createSkillResult({ success: false, errorCode: 'ALREADY_ACCEPTED', errorMessage: 'Esta invitación ya fue utilizada.' });
    }
    if (new Date(invite.expires_at) < new Date()) {
      return createSkillResult({ success: false, errorCode: 'INVITE_EXPIRED', errorMessage: 'Esta invitación ha expirado.' });
    }

    const { data: club } = await supabase.from('lg_clubs').select('name').eq('id', invite.club_id).maybeSingle();

    // Mask email: show first 2 chars + domain
    const [local, domain] = invite.email.split('@');
    const maskedEmail = local.slice(0, 2) + '***@' + domain;

    return createSkillResult({
      success: true,
      data: {
        is_new:       !invite.user_id,
        club_name:    club?.name || 'Club',
        email_masked: maskedEmail,
      },
    });
  }

  async _acceptClubInvite({ token, password }, supabase) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const now       = new Date().toISOString();

    const { data: invite } = await supabase
      .from('lg_club_invites')
      .select('id, email, club_id, user_id, expires_at, accepted_at')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (!invite || invite.accepted_at || new Date(invite.expires_at) < new Date()) {
      return createSkillResult({ success: false, errorCode: 'INVALID_INVITE', errorMessage: 'Invitación inválida o expirada.' });
    }

    if (invite.user_id) {
      // Existing user — role already assigned by fn_invite_club_admin, just mark accepted
      await supabase.from('lg_club_invites').update({ accepted_at: now }).eq('id', invite.id);
      return createSkillResult({ success: true, data: { is_new: false } });
    }

    // New user — create account via Supabase signUp (public API, no service_role needed)
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email:    invite.email,
      password,
    });

    if (signUpError || !signUpData?.user) {
      return createSkillResult({
        success: false,
        errorCode: 'SIGNUP_FAILED',
        errorMessage: signUpError?.message || 'Error al crear la cuenta.',
      });
    }

    const newUserId = signUpData.user.id;

    await supabase
      .from('lg_club_users')
      .upsert({ club_id: invite.club_id, user_id: newUserId, role: 'ADMIN_CLUB' }, { onConflict: 'club_id,user_id' });

    await supabase
      .from('lg_club_invites')
      .update({ accepted_at: now, user_id: newUserId })
      .eq('id', invite.id);

    return createSkillResult({ success: true, data: { is_new: true } });
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
