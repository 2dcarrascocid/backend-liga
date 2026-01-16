import { supabaseAdmin } from '../../services/db.js';
import { successResponse, errorResponse } from '../../utils/response.js';
import { handleError } from '../../utils/errors.js';
import { validateBody } from '../../utils/validator.js';
import { validateApiKey } from '../../utils/security.js';

export const handler = async (event) => {
  try {
    validateApiKey(event);
    const { id_token } = validateBody(event.body, ['id_token']);

    const { data, error } = await supabaseAdmin.auth.signInWithIdToken({
      provider: 'google',
      token: id_token,
    });

    if (error) {
      console.error('Supabase Google Sign-In Error:', error);
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
