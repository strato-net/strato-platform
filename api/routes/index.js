const express = require('express');
const router = express.Router();

const authHandler = require('../middlewares/authHandler.js');

const authController = require('../controllers/auth');


router.post('/login', authController.login);

router.post('/users', authHandler.validateRequest(), authController.create);

router.post('/logout', authHandler.validateRequest(), authController.logout);

// TODO:
// router.post('/tokens', authHandler.validateRequest(), tokenController.create);
// router.get('/tokens', authHandler.validateRequest(), tokenController.list);
// router.delete('/tokens', authHandler.validateRequest(), tokenController.delete);

// TODO: nodes...

module.exports = router;
