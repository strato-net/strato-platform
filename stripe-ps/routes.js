const express = require('express');

const customerAddress = require('./CustomerAddress');
const stripeService = require('./StripeService');

const router = express.Router();

router.use('/customer', customerAddress);
router.use('/stripe', stripeService);

router.use('/ping', async (req, res) => res.status(200).json({success: true, message: 'pong'}))

module.exports = router;
