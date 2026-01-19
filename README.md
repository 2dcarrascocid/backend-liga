# Backend Serverless - FPLAYCHILE- LIGA

Este proyecto es un backend construido con **Node.js 20**, **Serverless Framework 4.x**, y desplegado en **AWS Lambda**. Permite manejar usuarios, login y gestión de partidos de fútbol.

---

## Tecnologías y librerías usadas

- **Node.js 20**: runtime principal.
- **Serverless Framework 4.x**: para despliegue en AWS Lambda.
- **dotenv**: gestión de variables de entorno.
- **@supabase/supabase-js**: cliente para conectarse a la base de datos Supabase/PostgreSQL.
- **serverless-offline**: para pruebas locales de las funciones Lambda.
- **Swagger / OpenAPI**: documentación de los endpoints en `/api/docs`.
- **ES Modules**: se utiliza `"type": "module"` en `package.json`.

---

## Estructura del proyecto
backend-sls/
│
├─ routes/                 # Endpoints agrupados por funcionalidad (usuarios, login, partidos)
├─ services/               # Servicios de conexión a DB y utilidades
├─ node_modules/
├─ .env                    # Variables de entorno
├─ .gitignore
├─ serverless.yml          # Configuración de Serverless Framework
├─ package.json
└─ README.md

---

## Paginación estándar en listados

Todos los endpoints GET que retornan listas soportan paginación basada en tokens.

### Query params

- `limit` (opcional): cantidad de registros por página. Si no se envía, se usa `10`.
- `next_token` (opcional): token opaco para obtener la siguiente página.

### Formato de respuesta en listados

```json
{
  "data": [],
  "next_token": null,
  "total_registros": 0,
  "limit": 10
}
```

- `data`: lista paginada.
- `next_token`: `null` si no hay más páginas; token válido si existe página siguiente.
- `total_registros`: total de registros que cumplen los filtros, sin paginar.
- `limit`: límite efectivo utilizado en la consulta.

