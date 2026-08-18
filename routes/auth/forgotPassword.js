import { supabaseAdmin } from '../../services/db.js'
import { successResponse } from '../../utils/response.js'
import { handleError } from '../../utils/errors.js'
import { validateBody } from '../../utils/validator.js'
import { validateApiKey } from '../../utils/security.js'
import { sendPasswordResetEmail } from '../../utils/mailer.js'

export const handler = async (event) => {
  try {
    validateApiKey(event)
    const { email } = validateBody(event.body, ['email'])

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'

    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: {
        redirectTo: `${frontendUrl}/reset-password`,
      },
    })

    if (!error && data?.properties?.action_link) {
      try {
        await sendPasswordResetEmail(email, data.properties.action_link)
      } catch (mailError) {
        console.error('Error enviando email de recuperación:', mailError)
      }
    }

    // Respuesta genérica para no revelar si el email existe o no
    return successResponse({
      message: 'Si el email está registrado, recibirás un enlace de recuperación en los próximos minutos.',
    })
  } catch (error) {
    return handleError(error)
  }
}
