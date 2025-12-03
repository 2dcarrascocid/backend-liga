export function verifyApiKey(event) {
  const providedKey =
    event.headers?.['x-api-key'] ||
    event.headers?.['X-Api-Key'] ||
    event.headers?.['authorization']

  if (!providedKey || providedKey !== process.env.API_KEY) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'API Key inválida o no proporcionada' }),
    }
  }

  return null // ✅ Todo OK
}
