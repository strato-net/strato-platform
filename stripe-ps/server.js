const express = require('express');
const helmet = require('helmet');
const bodyParser = require('body-parser');
const cors = require('cors');
const { log, ExpressAPILogMiddleware } = require('@rama41222/node-logger');

const StripeService = require('./helpers/stripe.service');

const config = {
    name: 'Payment Server (Stripe)',
    port: process.env.PORT || 8018,
    host: '127.0.0.1',
};

const app = express();
const logger = log({ console: true, file: false, label: config.name });

app.use(helmet());
app.use(bodyParser.json());
app.use(cors());
app.use(ExpressAPILogMiddleware(logger, { request: true }));

app.get('/', (req, res) => {
    res.status(200).send('You have made contact with the payment server successfully.');
});

app.get('/ping', (req, res) => {
    res.status(200).send('Pong');
});

app.listen(config.port, config.host, (e)=> {
    if(e) {
        throw new Error('Internal Server Error');
    }
    logger.info(`${config.name} running on ${config.host}:${config.port}`);
});

app.get('/onboard', (req, res) => {
  res.status(200).send('/onboard');
});

app.get('/status', (req, res) => {
  res.status(200).send('/status');
});

app.post('/webhook', (req, res) => {
  res.status(200).send('/webhook');
});

app.post('/webhook/connect', (req, res) => {
  res.status(200).send('/webhook/connect');
});

app.get('/shippingAddress', (req, res) => {
  res.status(200).send('/shippingAddress GET');
});

app.post('/shippingAddress', (req, res) => {
  res.status(200).send('/shippingAddress POST')
});