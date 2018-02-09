const express = require('express');
const router = express.Router();

const authHandler = require('../middlewares/authHandler.js');

const authController = require('../controllers/auth');
const dappController = require('../controllers/dapp');
// const tokenController = require('../controllers/token');
const trackHandler = require('../controllers/track');
const healthHandler = require('../controllers/health');

router.post('/dapps', dappController.upload);

// router.get('/dapps', dappController.list);

router.post('/login', authController.login);
router.post('/users', authController.create);
router.post('/logout', authHandler.validateRequest(), authController.logout);

// Node governance (for future)
// router.get('/nodes', authHandler.validateRequest(), nodeController.list);
// app.get('/_auth', authController.checkAuthenticated); // see https://github.com/nikitamendelbaum/blockapps-task/blob/strato-auth-poc/
// Invite to network with token
// router.post('/tokens', authHandler.validateRequest(), tokenController.create);
// router.get('/tokens', authHandler.validateRequest(), tokenController.list);
// router.delete('/tokens', authHandler.validateRequest(), tokenController.revoke);

router.get('/_track', trackHandler._track);

router.get('/health-check', healthHandler.healthCheck);

module.exports = router;
