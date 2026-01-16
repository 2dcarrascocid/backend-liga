export const formatResponse = (statusCode, body, headers = {}) => {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Credentials': true,
      ...headers,
    },
    body: JSON.stringify(body),
  };
};

export const successResponse = (data, statusCode = 200) => {
  return formatResponse(statusCode, data);
};

export const errorResponse = (message, statusCode = 500, code = 'INTERNAL_ERROR') => {
  return formatResponse(statusCode, {
    error: {
      message,
      code,
    },
  });
};
