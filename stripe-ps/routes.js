const express = require('express');

const customerAddress = require('./CustomerAddress');
const stripeService = require('./StripeService');

const router = express.Router();

router.use('/customer', customerAddress);
router.use('/stripe', stripeService);

module.exports = router;