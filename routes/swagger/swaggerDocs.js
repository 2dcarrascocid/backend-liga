import fs from "fs";
import path from "path";

export const handler = async () => {
  try {
    // 🟩 Ruta ABSOLUTA siempre correcta, offline y deploy
    const swaggerPath = path.join(process.cwd(), "swagger.json");

    console.log("Swagger path:", swaggerPath);

    if (!fs.existsSync(swaggerPath)) {
      throw new Error(`No se encontró swagger.json en: ${swaggerPath}`);
    }

    const raw = fs.readFileSync(swaggerPath, "utf8");
    const spec = JSON.parse(raw);

    const html = `
<!DOCTYPE html>
<html>
  <head>
    <title>API Fair Play Chile</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger"></div>
    <script src="https://unpkg.com/swagger-ui-dist/swagger-ui-bundle.js"></script>
    <script>
      SwaggerUIBundle({
        spec: ${JSON.stringify(spec)},
        dom_id: '#swagger'
      });
    </script>
  </body>
</html>
`;

    return {
      statusCode: 200,
      headers: { "Content-Type": "text/html" },
      body: html,
    };
  } catch (err) {
    console.error("ERROR SWAGGER:", err);

    return {
      statusCode: 500,
      body: JSON.stringify(
        {
          message: "Swagger error",
          error: err.message,
          stack: err.stack,
        },
        null,
        2
      ),
    };
  }
};
