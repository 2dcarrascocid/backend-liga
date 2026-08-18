/**
 * OpenAPI 3.0 Documentation Handler
 * GET /api/docs
 */

const OPENAPI_SPEC = {
  openapi: '3.0.3',
  info: {
    title: 'Fair Play Chile API - Módulo de Transferencias y KPIs',
    version: '1.0.0',
    description: 'API Serverless para la gestión de transferencias de jugadores, rotación de rosters y tableros de control/KPIs de Fair Play Chile.',
  },
  servers: [
    {
      url: 'http://localhost:3000',
      description: 'Entorno de Desarrollo Local',
    },
  ],
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'x-api-key',
      },
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
    schemas: {
      Transfer: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          player_id: { type: 'string', format: 'uuid' },
          origin_club_id: { type: 'string', format: 'uuid' },
          destination_club_id: { type: 'string', format: 'uuid' },
          transfer_date: { type: 'string', format: 'date-time' },
          fee: { type: 'number', example: 150000.00 },
          status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] },
          requested_by: { type: 'string', format: 'uuid' },
          approved_by: { type: 'string', format: 'uuid' },
          notes: { type: 'string' },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      PaginatedTransfers: {
        type: 'object',
        properties: {
          data: {
            type: 'array',
            items: { $ref: '#/components/schemas/Transfer' },
          },
          next_token: { type: 'string', nullable: true },
          total_registros: { type: 'integer', example: 42 },
          limit: { type: 'integer', example: 10 },
        },
      },
      KpiSummary: {
        type: 'object',
        properties: {
          total_transfers: { type: 'integer' },
          by_status: {
            type: 'object',
            properties: {
              APPROVED: { type: 'integer' },
              PENDING: { type: 'integer' },
              REJECTED: { type: 'integer' },
              CANCELLED: { type: 'integer' },
            },
          },
          total_fee_amount: { type: 'number' },
          avg_resolution_days: { type: 'number' },
          top_destination_club: { type: 'object', nullable: true },
          top_origin_club: { type: 'object', nullable: true },
        },
      },
      ClubKpis: {
        type: 'object',
        properties: {
          club_id: { type: 'string', format: 'uuid' },
          purchases: { type: 'integer' },
          sales: { type: 'integer' },
          total_spent: { type: 'number' },
          total_revenue: { type: 'number' },
          net_balance: { type: 'number' },
        },
      },
    },
  },
  security: [
    { ApiKeyAuth: [], BearerAuth: [] },
  ],
  paths: {
    '/transfers': {
      get: {
        summary: 'Listar transferencias con filtros y paginación por tokens',
        parameters: [
          { name: 'player_id', in: 'query', schema: { type: 'string' } },
          { name: 'origin_club_id', in: 'query', schema: { type: 'string' } },
          { name: 'destination_club_id', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 10 } },
          { name: 'next_token', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: 'Lista paginada de transferencias',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PaginatedTransfers' },
              },
            },
          },
        },
      },
      post: {
        summary: 'Solicitar/crear nueva transferencia',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['player_id', 'origin_club_id', 'destination_club_id'],
                properties: {
                  player_id: { type: 'string' },
                  origin_club_id: { type: 'string' },
                  destination_club_id: { type: 'string' },
                  fee: { type: 'number', default: 0 },
                  notes: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Transferencia creada' },
        },
      },
    },
    '/transfers/{id}': {
      get: {
        summary: 'Obtener detalle de transferencia',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'Detalle de la transferencia' },
        },
      },
    },
    '/transfers/{id}/status': {
      patch: {
        summary: 'Aprobar, rechazar o cancelar transferencia',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['status'],
                properties: {
                  status: { type: 'string', enum: ['APPROVED', 'REJECTED', 'CANCELLED'] },
                  notes: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Estado actualizado' },
        },
      },
    },
    '/transfers/kpis/summary': {
      get: {
        summary: 'Obtener resumen global de KPIs del período',
        responses: {
          200: {
            description: 'Métricas globales',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/KpiSummary' },
              },
            },
          },
        },
      },
    },
    '/transfers/kpis/club/{club_id}': {
      get: {
        summary: 'Obtener indicadores de transferencias específicos de un club',
        parameters: [
          { name: 'club_id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: 'Métricas de club',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ClubKpis' },
              },
            },
          },
        },
      },
    },
  },
};

export const getSwaggerDocs = async () => {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(OPENAPI_SPEC),
  };
};
