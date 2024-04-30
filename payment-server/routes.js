import express from 'express';

import customerAddress from './CustomerAddress/index.js';
import stripeService from './StripeService/index.js';

const router = express.Router();

router.use('/customer', customerAddress);
router.use('/stripe', stripeService);

router.use('/ping', async (req, res) => res.status(200).json({success: true, message: 'pong'}))

export default router;
