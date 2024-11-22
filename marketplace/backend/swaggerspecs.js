import swaggerJsdoc from 'swagger-jsdoc';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Framework Express API',
      version: '0.1.0',
    },
    host: 'localhost:3030',
    basePath: '/api/v1',
    servers: [
      {
        url: 'http://localhost:3030/api/v1',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
  },
  apis: [
    './api/v1/users/users.yaml',
    './api/v1/Category/category.yaml',
    './api/v1/SubCategory/subCategory.yaml',
    './api/v1/Product/product.yaml',
    './api/v1/Inventory/inventory.yaml',
    './api/v1/Item/item.yaml',
    './api/v1/Order/order.yaml',
    './api/v1/Event/event.yaml',
  ],
};

const specs = swaggerJsdoc(options);

export default specs;
