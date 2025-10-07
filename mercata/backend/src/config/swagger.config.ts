import swaggerJSDoc from 'swagger-jsdoc';
import { version } from '../../package.json';

const swaggerOptions: swaggerJSDoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Mercata API',
      version: version,
      description: 'API documentation for Mercata backend - A decentralized finance platform',
      contact: {
        name: 'Mercata Team',
      },
      license: {
        name: 'Apache-2.0',
        url: 'https://www.apache.org/licenses/LICENSE-2.0.html',
      },
    },
    servers: [
      {
        url: '/api',
        description: 'Current server',
      },
    ],
    components: {
      schemas: {
        Error: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: 'Error message',
            },
            status: {
              type: 'integer',
              description: 'HTTP status code',
            },
            stack: {
              type: 'string',
              description: 'Error stack trace (only in development)',
            },
          },
        },
        HealthResponse: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              example: 'backend',
            },
            version: {
              type: 'string',
              example: '1.0.0',
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
      },
    },
  },
  apis: [
    './src/api/routes.ts',
    './src/api/routes/*.ts',
    './src/api/controllers/*.ts',
  ],
};

export const swaggerSpec = swaggerJSDoc(swaggerOptions);
