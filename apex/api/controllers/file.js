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

module.exports = {
  postFile: function (req, res, next) {
    const content = req.body.content;
    const provider = req.body.provider;
    const description = req.body.description;

    if (!content || !provider || !description) {
      let err = new Error('something went wrong');
      err.status = 400;
      return next(err);
    }

    var params = {
      Key: 'file.originalFilename', //file.name doesn't exist as a property
      Body: 'data'
    };

    s3bucket.upload(params, function (err, data) {
      console.log("PRINT FILE:", file);
      if (err) {
        console.log('ERROR MSG: ', err);
        res.status(500).send(err);
      } else {
        console.log('Successfully uploaded data');
        res.status(200).end();
      }
    });

    res.status(200).json({ user: 'Nice job' });
  },

  verifyFile: function (req, res, next) {
    res.status(200).json({ user: 'verify post file' });
  }
};
