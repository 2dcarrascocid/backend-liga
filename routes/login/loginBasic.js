import * as crud from './crud_login.js';
import * as funciones from './funciones.js';
import { validateApiKey } from '../../utils/apiKeyMiddleware.js';

export const register = async (event) => {
  try {
    // Validar API Key
    const apiKeyValidation = validateApiKey(event);
    if (!apiKeyValidation.valid) {
      return apiKeyValidation.response;
    }

    const body = JSON.parse(event.body);
    const { email, password, nombre, ...metadata } = body;

    if (!email || !password) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Email y password son obligatorios' }),
      };
    }

    // 1. Registrar usuario local
    // Nota: registerLocalUser ya normaliza el email y hashea el password
    const user = await crud.registerLocalUser({
      email,
      password,
      metadata: { nombre, ...metadata }
    });

    // 2. Generar tokens y sesión
    const accessToken = await funciones.generateAccessToken(user.id);
    const refreshToken = funciones.generateRefreshToken();
    const refreshTokenHash = funciones.hashRefreshToken(refreshToken);
    const expireAt = funciones.refreshTokenExpireAt();

    const sessionMeta = funciones.buildSessionMetadata(event);

    const session = await crud.createSession({
      usuario_id: user.id,
      refresh_token_hash: refreshTokenHash,
      user_agent: sessionMeta.userAgent,
      ip_address: sessionMeta.ip,
      dispositivo: sessionMeta.device,
      valido: true,
      created_at: new Date().toISOString(),
      expire_at: expireAt
    });

    // 3. Obtener roles y permisos (por defecto jugador al registrarse)
    const roles = await crud.getUserRoles(user.id);
    const permisos = await crud.getUserPermissions(user.id);

    // 4. Construir respuesta
    const response = funciones.buildAuthResponse({
      user,
      roles,
      permisos,
      accessToken,
      refreshToken,
      sessionId: session.id
    });

    return {
      statusCode: 201,
      body: JSON.stringify(response),
    };

  } catch (error) {
    console.error("Register Error:", error);
    return {
      statusCode: error.message === 'Email ya registrado' ? 409 : 500,
      body: JSON.stringify({ message: error.message }),
    };
  }
};

export const login = async (event) => {
  try {
    // Validar API Key
    const apiKeyValidation = validateApiKey(event);
    if (!apiKeyValidation.valid) {
      return apiKeyValidation.response;
    }

    const body = JSON.parse(event.body);
    const { email, password } = body;

    if (!email || !password) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Email y password son obligatorios' }),
      };
    }

    // 1. Validar credenciales
    const user = await crud.loginLocal({ email, password });

    // 2. Generar tokens y sesión
    const accessToken = await funciones.generateAccessToken(user.id);
    const refreshToken = funciones.generateRefreshToken();
    const refreshTokenHash = funciones.hashRefreshToken(refreshToken);
    const expireAt = funciones.refreshTokenExpireAt();

    const sessionMeta = funciones.buildSessionMetadata(event);

    const session = await crud.createSession({
      usuario_id: user.id,
      refresh_token_hash: refreshTokenHash,
      user_agent: sessionMeta.userAgent,
      ip_address: sessionMeta.ip,
      dispositivo: sessionMeta.device,
      valido: true,
      created_at: new Date().toISOString(),
      expire_at: expireAt
    });

    // 3. Obtener roles y permisos
    const roles = await crud.getUserRoles(user.id);
    const permisos = await crud.getUserPermissions(user.id);

    // 4. Construir respuesta
    const response = funciones.buildAuthResponse({
      user,
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
    console.error("Login Error:", error);
    const isAuthError = ['Usuario no encontrado', 'Usuario sin credenciales locales', 'Credenciales inválidas'].includes(error.message);
    return {
      statusCode: isAuthError ? 401 : 500,
      body: JSON.stringify({ message: error.message }),
    };
  }
};
