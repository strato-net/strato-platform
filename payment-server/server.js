import bodyParser from 'body-parser';
import cors from 'cors';
import dayjs from 'dayjs';
import express from 'express';
import expressWinston from 'express-winston';
import helmet from 'helmet';
import winston from 'winston';

import { clientErrorHandler, commonErrorHandler } from './helpers/utils.js';
import routes from './routes.js';

const config = {
    name: 'Payment Server (Stripe)',
    port: process.env.PORT || 8018,
};

const app = express();

// Middleware
app.use(helmet());
app.use(bodyParser.json());
app.use(cors());

// Logging
app.use(
  expressWinston.logger({
    transports: [new winston.transports.Console()],
    meta: true,
    expressFormat: true
  })
);

// Routes
app.use('/', routes);

// Error Handlers
app.use(clientErrorHandler);
app.use(commonErrorHandler);

app.listen(config.port, (e)=> {
    if(e) {
        throw new Error('Internal Server Error');
    }
    console.log(`Listening on ${config.port}`)
});