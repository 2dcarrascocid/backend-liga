import nodemailer from 'nodemailer'
import '../config/env.js'

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

export const sendPasswordResetEmail = async (toEmail, resetLink) => {
  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Recuperar contraseña</title>
</head>
<body style="margin:0;padding:0;background:#E8F0F5;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#E8F0F5;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

          <!-- Logo / Header -->
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:linear-gradient(135deg,#0891B2,#22D3EE);border-radius:50%;width:48px;height:48px;text-align:center;vertical-align:middle;">
                    <span style="color:#fff;font-size:22px;font-weight:700;line-height:48px;">L</span>
                  </td>
                  <td style="padding-left:12px;font-size:22px;font-weight:700;color:#0891B2;vertical-align:middle;letter-spacing:-0.5px;">
                    Liga App
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#E8F0F5;border-radius:24px;padding:40px 40px 36px;box-shadow:-8px -8px 20px rgba(255,255,255,0.85),8px 8px 20px rgba(184,197,208,0.7);">

              <!-- Icon -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding-bottom:24px;">
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="background:rgba(8,145,178,0.12);border-radius:20px;width:72px;height:72px;text-align:center;vertical-align:middle;">
                          <span style="font-size:36px;line-height:72px;">🔑</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Title -->
                <tr>
                  <td align="center" style="padding-bottom:12px;">
                    <h1 style="margin:0;font-size:26px;font-weight:700;color:#164E63;letter-spacing:-0.5px;">
                      Recupera tu contraseña
                    </h1>
                  </td>
                </tr>

                <!-- Body text -->
                <tr>
                  <td align="center" style="padding-bottom:32px;">
                    <p style="margin:0;font-size:15px;color:#475569;line-height:1.7;max-width:400px;">
                      Recibimos una solicitud para restablecer la contraseña de tu cuenta en Liga App.
                      Haz clic en el botón de abajo para crear una nueva contraseña.
                    </p>
                  </td>
                </tr>

                <!-- CTA Button -->
                <tr>
                  <td align="center" style="padding-bottom:32px;">
                    <a href="${resetLink}"
                       style="display:inline-block;background:linear-gradient(135deg,#0891B2,#22D3EE);color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:50px;box-shadow:0 4px 18px rgba(8,145,178,0.35);">
                      Restablecer contraseña
                    </a>
                  </td>
                </tr>

                <!-- Expiry warning -->
                <tr>
                  <td align="center" style="padding-bottom:28px;">
                    <table cellpadding="0" cellspacing="0" style="background:rgba(245,158,11,0.1);border-radius:12px;border:1px solid rgba(245,158,11,0.25);">
                      <tr>
                        <td style="padding:12px 20px;font-size:13px;color:#92400E;">
                          ⏱️ &nbsp;Este enlace expirará en <strong>1 hora</strong>.
                          Si no solicitaste este cambio, ignora este correo.
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Link fallback -->
                <tr>
                  <td align="center" style="padding-bottom:8px;">
                    <p style="margin:0;font-size:12px;color:#64748B;">
                      Si el botón no funciona, copia y pega este enlace en tu navegador:
                    </p>
                  </td>
                </tr>
                <tr>
                  <td align="center">
                    <p style="margin:0;font-size:11px;color:#0891B2;word-break:break-all;">
                      ${resetLink}
                    </p>
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:24px;">
              <p style="margin:0;font-size:12px;color:#94A3B8;">
                © ${new Date().getFullYear()} Liga App · Fairplay Chile ·
                <a href="#" style="color:#0891B2;text-decoration:none;">Soporte</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`

  await transporter.sendMail({
    from: process.env.SMTP_FROM || '"Liga App" <no-reply@ligaapp.com>',
    to: toEmail,
    subject: '🔑 Restablecer tu contraseña — Liga App',
    html,
  })
}

export const sendClubAdminInviteEmail = async (toEmail, clubName, inviteLink, isNewUser) => {
  const subject = isNewUser
    ? `Invitación para administrar ${clubName} — Liga App`
    : `Acceso asignado: administrador de ${clubName} — Liga App`;

  const headline = isNewUser
    ? `Fuiste invitado a administrar <strong>${clubName}</strong>`
    : `Tu cuenta tiene acceso de administrador a <strong>${clubName}</strong>`;

  const bodyText = isNewUser
    ? `Haz clic en el botón para crear tu contraseña y comenzar a gestionar el club.`
    : `Ya puedes iniciar sesión con tu cuenta existente. Haz clic en el botón para confirmar tu acceso.`;

  const btnText = isNewUser ? 'Crear contraseña y acceder' : 'Confirmar acceso al club';

  const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#E8F0F5;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#E8F0F5;padding:40px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

        <tr><td align="center" style="padding-bottom:28px;">
          <table cellpadding="0" cellspacing="0"><tr>
            <td style="background:linear-gradient(135deg,#0891B2,#22D3EE);border-radius:50%;width:48px;height:48px;text-align:center;vertical-align:middle;">
              <span style="color:#fff;font-size:22px;font-weight:700;line-height:48px;">L</span>
            </td>
            <td style="padding-left:12px;font-size:22px;font-weight:700;color:#0891B2;vertical-align:middle;">Liga App</td>
          </tr></table>
        </td></tr>

        <tr><td style="background:#E8F0F5;border-radius:24px;padding:40px 40px 36px;box-shadow:-8px -8px 20px rgba(255,255,255,0.85),8px 8px 20px rgba(184,197,208,0.7);">
          <table width="100%" cellpadding="0" cellspacing="0">

            <tr><td align="center" style="padding-bottom:24px;">
              <div style="background:rgba(8,145,178,0.12);border-radius:20px;width:72px;height:72px;display:inline-flex;align-items:center;justify-content:center;font-size:36px;line-height:72px;">
                ⚽
              </div>
            </td></tr>

            <tr><td align="center" style="padding-bottom:12px;">
              <h1 style="margin:0;font-size:24px;font-weight:700;color:#164E63;">${headline}</h1>
            </td></tr>

            <tr><td align="center" style="padding-bottom:28px;">
              <p style="margin:0;font-size:15px;color:#475569;line-height:1.7;max-width:420px;">${bodyText}</p>
            </td></tr>

            <tr><td align="center" style="padding-bottom:28px;">
              <a href="${inviteLink}"
                 style="display:inline-block;background:linear-gradient(135deg,#0891B2,#22D3EE);color:#fff;font-size:16px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:50px;box-shadow:0 4px 18px rgba(8,145,178,0.35);">
                ${btnText}
              </a>
            </td></tr>

            <tr><td align="center">
              <table cellpadding="0" cellspacing="0" style="background:rgba(245,158,11,0.1);border-radius:12px;border:1px solid rgba(245,158,11,0.25);">
                <tr><td style="padding:12px 20px;font-size:13px;color:#92400E;">
                  ⏱️ &nbsp;Esta invitación expirará en <strong>7 días</strong>.
                </td></tr>
              </table>
            </td></tr>

          </table>
        </td></tr>

        <tr><td align="center" style="padding-top:24px;">
          <p style="margin:0;font-size:12px;color:#94A3B8;">© ${new Date().getFullYear()} Liga App · Fairplay Chile</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  await transporter.sendMail({
    from: process.env.SMTP_FROM || '"Liga App" <no-reply@ligaapp.com>',
    to: toEmail,
    subject,
    html,
  });
};
