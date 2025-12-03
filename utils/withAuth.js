// utils/withAuth.js

import { verifyApiKey } from './authMiddleware.js'; // ajusta esto si tu middleware real está en otro lado

export const withAuth = (handlerFn) => async (event, context) => {
  const unauthorized = verifyApiKey(event);
  if (unauthorized) {
    // unauthorized debe ser ya una response con statusCode, headers, body
    return unauthorized;
  }
  return handlerFn(event, context);
};
