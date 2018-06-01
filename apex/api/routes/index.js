const express = require('express');
const router = express.Router();

const authHandler = require('../middlewares/authHandler.js');

const authController = require('../controllers/auth');
const dappController = require('../controllers/dapp');
// const tokenController = require('../controllers/token');
const trackHandler = require('../controllers/track');
const healthHandler = require('../controllers/health');
const checkMode = require('../lib/checkMode').checkMode;
const fileController = require('../controllers/file');

router.post('/dapps', dappController.upload);

// router.get('/dapps', dappController.list);

router.post('/login', checkMode, authController.login);
router.post('/users', checkMode, authController.create);
router.post('/logout', checkMode, authHandler.validateRequest(), authController.logout);
router.post('/verify-email', checkMode, authController.verifyEmail);
router.post('/verify-temporary-password', checkMode, authController.verifyTemporaryPassword);

router.post('/postFile', fileController.postFile);
router.get('/verifyFile', fileController.verifyFile);
// Node governance (for future)
// router.get('/nodes', authHandler.validateRequest(), nodeController.list);
// app.get('/_auth', authController.checkAuthenticated); // see https://github.com/nikitamendelbaum/blockapps-task/blob/strato-auth-poc/
// Invite to network with token
// router.post('/tokens', authHandler.validateRequest(), tokenController.create);
// router.get('/tokens', authHandler.validateRequest(), tokenController.list);
// router.delete('/tokens', authHandler.validateRequest(), tokenController.revoke);

router.get('/status', healthHandler.nodeStatus);

router.get('/_ping', healthHandler.ping);

router.get('/_track', trackHandler._track);

module.exports = router;
