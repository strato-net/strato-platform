const express = require('express');
const multer = require('multer');
const router = express.Router();

const oAuthController = require('../controllers/oAuth');
const dappController = require('../controllers/dapp');
const healthHandler = require('../controllers/health');
const trackHandler = require('../controllers/track');
const appConfig = require(`${process.cwd()}/config/app.config`);
const oAuth = require(`${process.cwd()}/lib/oAuth/oAuth`);
const RestStatus = require(`${process.cwd()}/lib/rest-utils/rest-constants`);

const fileController = isOAuth() ? require(`${process.cwd()}/controllers/file.oAuth`) : require('../controllers/file');


const upload = multer({ storage: multer.memoryStorage() });

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
};

const checkUID = async (req, res, next) => {
  if (!isOAuth()) {
    return next();
  }
  const uID = req.headers['x-user-unique-name'];
  if (!uID) {
    // every request should have the username forwarded by nginx
    let err = new Error('server misconfigured: no x-user-unique-name header provided in request');
    console.error(err);
    err.status = RestStatus.INTERNAL_SERVER_ERROR;
    return next(err);
  }
  //validates or creates user account, will throw on failure
  try {
    await oAuth.getOrCreateKey(uID);
    return next()
  } catch (error) {
    let err = new Error('server misconfigured: could not post transaction');
    console.error(err);
    err.status = RestStatus.SERVICE_UNAVAILABLE;
    return next(err);
  }
};

router.post('/dapps', dappController.upload);

// router.get('/dapps', dappController.list);
router.post('/user', oAuthController.createUser);
router.post('/bloc/file/upload', checkUID, multerMiddleware, fileController.upload);
router.post('/bloc/file/attest', checkUID, fileController.attest);
router.get('/bloc/file/verify', fileController.verify);
router.get('/bloc/file/download', fileController.download);
router.get('/bloc/file/list', fileController.list)

router.get('/status', healthHandler.nodeStatus);
router.get('/health', healthHandler.healthStatus);
router.get('/_ping', healthHandler.ping);
router.get('/_track', trackHandler._track);


function isOAuth() {
  return process.env.OAUTH_ENABLED == appConfig.oAuthEnabledTrueValue;
}

module.exports = router;
