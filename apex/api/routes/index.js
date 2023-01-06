const express = require('express');
const router = express.Router();

const oAuthController = require('../controllers/oAuth');
const healthHandler = require('../controllers/health');
// const apiCounterHandler = require('../controllers/apiCounter');

// Endpoint called by SMD to create key for smd user logged in with oauth
router.post('/user', oAuthController.createUserKey);

// Health
router.get('/status', healthHandler.nodeStatus);
router.get('/health', healthHandler.healthStatus);
router.get('/_ping', healthHandler.ping);

/* Api counter disabled, to be deprecated  #api-counter-deprecation
 // Stats
if (process.env.STATS_ENABLED === "true") {
  router.get('/_api_counter', apiCounterHandler.apiCounterRouteController)
}
 */


module.exports = router;
