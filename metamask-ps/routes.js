const express = require('express');
const metamask = require('./MetaMask')
const router = express.Router();

router.use('/metamask', metamask);
router.use('/ping', async (req, res) => res.status(200).json({success: true, message: 'pong'}))

module.exports = router;