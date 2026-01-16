import { supabaseAdmin } from '../../services/db.js';
import { successResponse, errorResponse } from '../../utils/response.js';
import { handleError } from '../../utils/errors.js';
import { validateBody } from '../../utils/validator.js';
import { validateApiKey } from '../../utils/security.js';

export const handler = async (event) => {
  try {
    validateApiKey(event);
    const body = validateBody(event.body, []);
    const token = body.access_token || body.id_token;

    if (!token) {
        return errorResponse('Missing access_token or id_token', 400, 'MISSING_TOKEN');
    }

    // Intentamos usar signInWithIdToken. 
    // Nota: Para Facebook, esto requiere que el token sea un OIDC ID Token.
    // Si el cliente envía un Access Token clásico, esto podría fallar dependiendo de la config de Supabase.
    // Según la estrategia preferida, usamos esto.
    const { data, error } = await supabaseAdmin.auth.signInWithIdToken({
      provider: 'facebook',
      token: token,
    });

    if (error) {
      console.error('Supabase Facebook Sign-In Error:', error);
      return errorResponse(error.message, error.status || 401, error.code);
    }

    const userId = data.user.id;

    const { data: orgLinks, error: orgsError } = await supabaseAdmin
      .from('lg_org_users')
      .select('role, org:lg_orgs(*)')
      .eq('user_id', userId);

    const orgs =
      orgsError || !orgLinks
        ? []
        : orgLinks.map((row) => ({
            ...row.org,
            role: row.role,
          }));

    return successResponse({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      user: data.user,
      orgs,
    });
  } catch (error) {
    return handleError(error);
  }
};
