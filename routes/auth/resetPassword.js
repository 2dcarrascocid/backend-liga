import { supabaseAdmin } from '../../services/db.js'
import { successResponse, errorResponse } from '../../utils/response.js'
import { handleError } from '../../utils/errors.js'
import { validateBody } from '../../utils/validator.js'
import { validateApiKey } from '../../utils/security.js'

export const handler = async (event) => {
  try {
    validateApiKey(event)
    const { access_token, new_password } = validateBody(event.body, ['access_token', 'new_password'])

    if (new_password.length < 8) {
      return errorResponse(
        'La contraseña debe tener al menos 8 caracteres',
        400,
        'PASSWORD_TOO_SHORT'
      )
    }

    // Verificar el access_token y obtener el usuario
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(access_token)

    if (userError || !userData?.user) {
      return errorResponse(
        'El enlace de recuperación es inválido o ha expirado. Solicita uno nuevo.',
        401,
        'INVALID_OR_EXPIRED_TOKEN'
      )
    }

    const userId = userData.user.id

    // Actualizar la contraseña vía Admin API
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: new_password,
    })

    if (updateError) {
      console.error('Error actualizando contraseña:', updateError)
      return errorResponse(
        'Error al actualizar la contraseña. Intenta nuevamente.',
        500,
        'PASSWORD_UPDATE_FAILED'
      )
    }

    return successResponse({ message: 'Contraseña actualizada exitosamente. Ya puedes iniciar sesión.' })
  } catch (error) {
    return handleError(error)
  }
}
