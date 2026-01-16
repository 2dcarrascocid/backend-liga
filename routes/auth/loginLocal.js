import { supabaseAdmin } from '../../services/db.js'
import { successResponse, errorResponse } from '../../utils/response.js'
import { handleError } from '../../utils/errors.js'
import { validateBody } from '../../utils/validator.js'
import { validateApiKey } from '../../utils/security.js'
import bcrypt from 'bcryptjs'

export const handler = async (event) => {
  try {
    validateApiKey(event)
    const { email, password } = validateBody(event.body, ['email', 'password'])

    const { data, error } = await supabaseAdmin.auth.signInWithPassword({
      email,
      password,
    })

    if (!error && data?.session) {
      const userId = data.user.id

      const { data: orgLinks, error: orgsError } = await supabaseAdmin
        .from('lg_org_users')
        .select('role, org:lg_orgs(*)')
        .eq('user_id', userId)

      const orgs =
        orgsError || !orgLinks
          ? []
          : orgLinks.map((row) => ({
              ...row.org,
              role: row.role,
            }))

      return successResponse({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        user: data.user,
        orgs,
      })
    }

    if (error && error.code === 'invalid_credentials') {
      const { data: legacyUser, error: legacyError } = await supabaseAdmin
        .schema('auth')
        .from('users')
        .select('id, encrypted_password')
        .eq('email', email)
        .maybeSingle()

      if (legacyError || !legacyUser?.encrypted_password) {
        return errorResponse(error.message, error.status || 401, error.code)
      }

      const isValid = await bcrypt.compare(password, legacyUser.encrypted_password)

      if (!isValid) {
        return errorResponse(error.message, error.status || 401, error.code)
      }

      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
        legacyUser.id,
        { password }
      )

      if (updateError) {
        return errorResponse(
          'Error actualizando credenciales del usuario',
          500,
          'PASSWORD_MIGRATION_FAILED'
        )
      }

      const { data: dataAfterUpdate, error: errorAfterUpdate } =
        await supabaseAdmin.auth.signInWithPassword({
          email,
          password,
        })

      if (errorAfterUpdate) {
        return errorResponse(
          errorAfterUpdate.message,
          errorAfterUpdate.status || 401,
          errorAfterUpdate.code
        )
      }

      const userIdAfter = dataAfterUpdate.user.id

      const { data: orgLinksAfter, error: orgsErrorAfter } = await supabaseAdmin
        .from('lg_org_users')
        .select('role, org:lg_orgs(*)')
        .eq('user_id', userIdAfter)

      const orgsAfter =
        orgsErrorAfter || !orgLinksAfter
          ? []
          : orgLinksAfter.map((row) => ({
              ...row.org,
              role: row.role,
            }))

      return successResponse({
        access_token: dataAfterUpdate.session.access_token,
        refresh_token: dataAfterUpdate.session.refresh_token,
        user: dataAfterUpdate.user,
        orgs: orgsAfter,
      })
    }

    if (error) {
      return errorResponse(error.message, error.status || 401, error.code)
    }

    return errorResponse('Error desconocido en login', 500, 'UNKNOWN_LOGIN_ERROR')
  } catch (error) {
    return handleError(error)
  }
}
