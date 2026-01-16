import { AppError } from './errors.js';

export const validateApiKey = (event) => {
  const apiKey = event.headers['x-api-key'] || event.headers['X-Api-Key'];
  if (!apiKey || apiKey !== process.env.API_KEY) {
    throw new AppError('Invalid or missing API Key', 403, 'FORBIDDEN');
  }
};

export const extractBearerToken = (event) => {
  const authHeader = event.headers['Authorization'] || event.headers['authorization'];
  if (!authHeader) {
    throw new AppError('Missing Authorization header', 401, 'UNAUTHORIZED');
  }

  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw new AppError('Invalid Authorization header format', 401, 'UNAUTHORIZED');
  }

  return token;
};
