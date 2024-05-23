import express from 'express';
import metamask from './MetaMask/index.js'

const router = express.Router();

router.use('/metamask', metamask);
router.use('/ping', async (req, res) => res.status(200).json({success: true, message: 'pong'}))

export default router;