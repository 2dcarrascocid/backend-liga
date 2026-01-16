import { AppError } from './errors.js';

export const validateBody = (body, requiredFields) => {
  if (!body) {
    throw new AppError('Missing request body', 400, 'MISSING_BODY');
  }

  let parsedBody;
  try {
    parsedBody = typeof body === 'string' ? JSON.parse(body) : body;
  } catch (e) {
    throw new AppError('Invalid JSON body', 400, 'INVALID_JSON');
  }

  const missing = requiredFields.filter((field) => !parsedBody[field]);

  if (missing.length > 0) {
    throw new AppError(`Missing required fields: ${missing.join(', ')}`, 400, 'MISSING_FIELDS');
  }

  return parsedBody;
};
