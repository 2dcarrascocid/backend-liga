import * as crud from './crud_login.js';
import * as funciones from './funciones.js';
import { supabase } from '../../services/db.js';
import { validateApiKey } from '../../utils/apiKeyMiddleware.js';

export const login = async (event) => {
  try {
    // Validar API Key
    const apiKeyValidation = validateApiKey(event);
    if (!apiKeyValidation.valid) {
      return apiKeyValidation.response;
    }

    const body = JSON.parse(event.body);
    const { idToken } = body;

    if (!idToken) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'idToken es obligatorio' }),
      };
    }

    // 1. Verificar token de Google
    const googlePayload = await funciones.verifyGoogleToken(idToken);
    const { email, sub: googleId, name, picture } = googlePayload;
    const normalizedEmail = funciones.normalizeEmail(email);

    // 2. Buscar si ya existe la vinculación social
    let socialIdentity = await supabase
      .from("el_dep_proveedor_autenticacion")
      .select("*")
      .eq("proveedor", "google")
      .eq("proveedor_user_id", googleId)
      .maybeSingle()
      .then(res => res.data);

    let userId;

    if (socialIdentity && socialIdentity.usuario_id) {
      // Caso A: Ya existe y está vinculado
      userId = socialIdentity.usuario_id;
    } else {
      // Caso B: No existe vinculación o está huérfana.
      // Buscamos si existe el usuario por email
      let user = await crud.findUserByEmail(normalizedEmail);

      if (!user) {
        // Crear usuario nuevo
        user = await crud.createUserIdentity({
          email: normalizedEmail,
          provider: 'google',
          metadata: { nombre: name, foto: picture }
        });

        // Asignar rol por defecto
        await crud.assignRoleToUser(user.id, 'jugador');
      }

      userId = user.id;

      // Crear o actualizar vinculación social
      if (socialIdentity) {
        // Actualizar huérfano
        await supabase
          .from("el_dep_proveedor_autenticacion")
          .update({ usuario_id: userId })
          .eq("id", socialIdentity.id);
      } else {
        // Crear nuevo
        await supabase
          .from("el_dep_proveedor_autenticacion")
          .insert({
            proveedor: 'google',
            proveedor_user_id: googleId,
            email: normalizedEmail,
            usuario_id: userId,
            metadata: { name, picture }
          });
      }
    }

    // 3. Generar tokens y sesión
    const accessToken = await funciones.generateAccessToken(userId);
    const refreshToken = funciones.generateRefreshToken();
    const refreshTokenHash = funciones.hashRefreshToken(refreshToken);
    const expireAt = funciones.refreshTokenExpireAt();

    const sessionMeta = funciones.buildSessionMetadata(event);

    const session = await crud.createSession({
      usuario_id: userId,
      refresh_token_hash: refreshTokenHash,
      user_agent: sessionMeta.userAgent,
      ip_address: sessionMeta.ip,
      dispositivo: sessionMeta.device,
      valido: true,
      created_at: new Date().toISOString(),
      expire_at: expireAt
    });

    // 4. Obtener datos finales
    const userFinal = await crud.findUserById(userId);
    const roles = await crud.getUserRoles(userId);
    const permisos = await crud.getUserPermissions(userId);

    const response = funciones.buildAuthResponse({
      user: userFinal,
      roles,
      permisos,
      accessToken,
      refreshToken,
      sessionId: session.id
    });

    return {
      statusCode: 200,
      body: JSON.stringify(response),
    };

  } catch (error) {
    console.error("Google Login Error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: error.message }),
    };
  }
};
