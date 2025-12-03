export const withJsonResponse = (handlerFn) => async (event, context) => {
  const response = await handlerFn(event, context);

  return {
    statusCode: response?.statusCode ?? 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      ...(response.headers || {}),
    },
    body:
      typeof response.body === "string"
        ? response.body
        : JSON.stringify(response),
  };
};
