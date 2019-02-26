const express = require('express');
const router = express.Router();

const authHandler = require('../middlewares/authHandler.js');

const authController = require('../controllers/auth');
const oAuthController = require('../controllers/oAuth');
const dappController = require('../controllers/dapp');
// const tokenController = require('../controllers/token');
const trackHandler = require('../controllers/track');
const healthHandler = require('../controllers/health');
const checkMode = require('../lib/checkMode').checkMode;
const fileController = require('../controllers/file');
const appConfig = require(`${process.cwd()}/config/app.config`);
const multer = require('multer');
var upload = multer({ storage: multer.memoryStorage() });

const multerMiddleware = (req, res, next) => {
  upload.single('content')(req, res, (error) => {
    if (!req.file) {
      let err = new Error('wrong params, expected: {content(file), username, password, address, provider, metadata}');
      err.status = 400;
      return next(err);
    }
    if (error) {
      if (error.status)
        return res.status(error.status).send({ reason: error.message });
      return res.status(400).send({ reason: error.message });
    }
    next();
  })
}

router.post('/dapps', dappController.upload);

// router.get('/dapps', dappController.list);

router.post('/login', checkMode, process.env.OAUTH_ENABLED==appConfig.oAuthEnabledTrueValue ? oAuthController.login : authController.login);
router.post('/users', checkMode, process.env.OAUTH_ENABLED==appConfig.oAuthEnabledTrueValue ? oAuthController.create : authController.create);
router.post('/logout', checkMode, authHandler.validateRequest(), authController.logout);
router.post('/verify-email', checkMode, authController.verifyEmail);
router.post('/verify-temporary-password', checkMode, authController.verifyTemporaryPassword);

router.post('/bloc/file/upload', multerMiddleware, fileController.upload);
router.post('/bloc/file/attest', fileController.attest);
router.get('/bloc/file/verify', fileController.verify);
router.get('/bloc/file/download', fileController.download);
router.get('/bloc/file/list', fileController.list)


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
