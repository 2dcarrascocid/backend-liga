'use strict';

export const main = async (event) => {
  console.log("Variable desde ENV:", process.env.DB_USER);

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: "Revisión ENV exitosa",
      DB_USER: process.env.DB_USER || 'No definida',
    }),
  };
};
