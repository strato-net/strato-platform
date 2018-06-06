/* jshint esnext: true */
const bcrypt = require('bcrypt');
const blockappsRest = require('blockapps-rest').rest;
const co = require('co');
const moment = require('moment');
var rp = require('request-promise');

const appConfig = require('../config/app.config');
const authHandler = require('../middlewares/authHandler.js');
const models = require('../models');
const s3 = require('../lib/s3');
const externalStorage = require('../lib/externalStorage/externalStorage');
const multer = require('multer');

module.exports = {
  uploadFile: function (req, res, next) {
    const content = req.body.content;
    const provider = req.body.provider;
    const metadata = req.body.metadata;
    
    if (!content || !provider || !metadata) {
      let err = new Error('something went wrong');
      err.status = 400;
      return next(err);
    }

    // var params = {
    //   Key: 'file.originalFilename',
    //   Body: 'data'
    // };

    // s3.upload(params, function (err, data) {
    //   console.log("PRINT FILE:", file);
    //   if (err) {
    //     console.log('ERROR MSG: ', err);
    //     res.status(500).send(err);
    //   } else {
    //     console.log('Successfully uploaded data');
    //     res.status(200).end();
    //   }
    // });

    // // Register contract with it's default vlaues
    // const args = {};
    // const userCredentials = {
    //   name: username,
    //   address: address,
    //   password: password
    // };

    // yield externalStorage.uploadContract(userCredentials, args);
    // -------------------------------------------------------

    res.status(200).json({ user: 'upload file' });
  },

  verifyFile: function (req, res, next) {
    res.status(200).json({ user: 'verify post file' });
  }
};
