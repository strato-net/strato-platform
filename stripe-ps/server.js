const bodyParser = require('body-parser');
const cors = require('cors');
const dayjs = require('dayjs');
const express = require('express');
const expressWinston = require('express-winston');
const helmet = require('helmet');
const winston = require('winston');

const { clientErrorHandler, commonErrorHandler } = require('./helpers/utils');
const routes = require('./routes');

const config = {
    name: 'Payment Server (Stripe)',
    port: 5434,
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