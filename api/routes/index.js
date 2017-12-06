const express = require('express');
const router = express.Router();

// const authHandler = require('../middlewares/authHandler.js');

// const authController = require('../controllers/auth');
const dappController = require('../controllers/dapp');
// const tokenController = require('../controllers/token');
const trackHandler = require('../controllers/track');


router.post('/dapps', dappController.upload);

// router.get('/dapps', dappController.list);


// TODO: uncomment when auth needed
// router.post('/login', authController.login);
//
// router.post('/users', authController.create);
//
// router.post('/logout', authHandler.validateRequest(), authController.logout);
//
// router.post('/tokens', authHandler.validateRequest(), tokenController.create);
//
// router.get('/tokens', authHandler.validateRequest(), tokenController.list);
//
// router.delete('/tokens', authHandler.validateRequest(), tokenController.revoke);

// TODO: create controllers
// router.get('/nodes', authHandler.validateRequest(), nodeController.list);
// app.get('/_auth', authController.checkAuthenticated); // see https://github.com/nikitamendelbaum/blockapps-task/blob/strato-auth-poc/

router.get('/_track', trackHandler._track);

module.exports = router;
