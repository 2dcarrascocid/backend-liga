import swaggerJSDoc from "swagger-jsdoc";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ruta a la raíz del proyecto backend-sls
const projectRoot = path.resolve(__dirname, "..");

// Ruta final del swagger.json
const outputPath = path.join(projectRoot, "swagger.json");

// Configuración swagger-jsdoc
const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "API Fair Play Chile",
      version: "1.0.0",

      // 🟩 Insertamos una fecha de actualización
      "x-updated-at": new Date().toISOString(), // fecha actual en ISO-8601

      description: `
        Documentación oficial de la API Fair Play Chile.
        Última actualización: ${new Date().toLocaleString()}
      `
    }
  },

  apis: ["routes/**/*.js"] // tus anotaciones en las rutas
};

// Generar swagger.json
const swaggerSpec = swaggerJSDoc(options);

// Guardar archivo
fs.writeFileSync(outputPath, JSON.stringify(swaggerSpec, null, 2));

console.log("==========================================");
console.log("✔ swagger.json generado con fecha de actualización");
console.log("Ruta:", outputPath);
console.log("Fecha:", swaggerSpec.info["x-updated-at"]);
console.log("==========================================");
