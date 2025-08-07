import express from 'express';

import customerAddress from './CustomerAddress/index.js';
import stripeService from './StripeService/index.js';
import redemption from './Redemptions/index.js';
import flagFile from "./helpers/flagFile.js";
// TODO: Disabled for initial payment server release
// import metamask from './MetaMask/index.js';

const router = express.Router();

router.use('/customer', customerAddress);
router.use('/stripe', stripeService);
router.use('/redemption', redemption);
// TODO: Disabled for initial payment server release
// router.use('/metamask', metamask);

router.use('/ping', async function (req, res) {
      const errorFlagRaised = await flagFile.isErrorFlagRaised();
      res.status(errorFlagRaised ? 500 : 200).json({success: !errorFlagRaised, message: 'pong'})
    }
)


export default router;
