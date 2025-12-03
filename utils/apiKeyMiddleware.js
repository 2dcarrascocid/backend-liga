// utils/apiKeyMiddleware.js
const API_KEY = process.env.API_KEY;

export const validateApiKey = (event) => {
    const apiKey = event.headers['x-api-key'] || event.headers['X-API-KEY'];

    if (!API_KEY) {
        // Si no hay API_KEY configurada en el .env, permitir acceso (modo desarrollo)
        return { valid: true };
    }

    if (!apiKey || apiKey !== API_KEY) {
        return {
            valid: false,
            response: {
                statusCode: 403,
                body: JSON.stringify({ message: 'API Key inválida o no proporcionada' }),
            }
        };
    }

    return { valid: true };
};
