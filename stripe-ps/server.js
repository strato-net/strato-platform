const bodyParser = require('body-parser');
const cors = require('cors');
const dayjs = require('dayjs');
const express = require('express');
const expressWinston = require('express-winston');
const helmet = require('helmet');
const winston = require('winston');

const routes = require('./routes');

const config = {
    name: 'Payment Server (Stripe)',
    port: process.env.PORT || 8018,
    host: '127.0.0.1',
};

const app = express();

app.use(helmet());
app.use(bodyParser.json());
app.use(cors());
app.use(
  expressWinston.logger({
    transports: [new winston.transports.Console()],
    meta: true,
    expressFormat: true
  })
);

app.use('/', routes);

app.listen(config.port, config.host, (e)=> {
    if(e) {
        throw new Error('Internal Server Error');
    }
    console.log(`Listening on ${config.host}:${config.port}`)
});