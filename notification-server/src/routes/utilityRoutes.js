const express = require("express");

const router = express.Router();

router.use('/ping', async (req, res) => res.status(200).json({success: true, message: 'pong'}))

module.exports = router;
