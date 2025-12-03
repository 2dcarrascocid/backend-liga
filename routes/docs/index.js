import swaggerJsdoc from "swagger-jsdoc";
import { options } from "./swaggerDocs.js";

export const handler = async () => {
  const swaggerSpec = swaggerJsdoc(options);
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(swaggerSpec),
  };
};
