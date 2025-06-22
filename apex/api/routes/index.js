const express = require('express');
const router = express.Router();

const oAuthController = require('../controllers/oAuth');
const healthHandler = require('../controllers/health');

// Endpoint called by SMD to create key for smd user logged in with oauth
router.post('/user', oAuthController.createUserKey);

// Health
router.get('/status', healthHandler.nodeStatus);
router.get('/health', healthHandler.healthStatus);
router.get('/_ping', healthHandler.ping);

module.exports = router;
