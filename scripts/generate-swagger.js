// scripts/generate-swagger.js
import swaggerJSDoc from "swagger-jsdoc";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Resolver __dirname en ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Opciones de swagger-jsdoc (como las tenías en la Lambda)
const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "API Fair Play Chile",
      version: "1.0.0",
    },
  },
  // Usamos ruta relativa desde la raíz del proyecto
  apis: ["routes/**/*.js"],
};

// Generar el spec
const swaggerSpec = swaggerJSDoc(options);

// Ruta final del archivo swagger.json en la raíz del proyecto
const outputPath = path.join(__dirname, "..", "swagger.json");

// Guardar el archivo
fs.writeFileSync(outputPath, JSON.stringify(swaggerSpec, null, 2), "utf8");

console.log(`✅ Swagger JSON generado en: ${outputPath}`);
