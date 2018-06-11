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

module.exports = {
  upload: function (req, res, next) {
    co(function* () {
      const content = req.body.content;
      const provider = req.body.provider;
      const metadata = req.body.metadata;

      const username = req.body.username;
      const password = req.body.password;
      const address = req.body.address;

      if (!content || !provider || !username || !password || !address) {
        let err = new Error('something went wrong');
        err.status = 400;
        return next(err);
      }

      // Register contract with it's default vlaues

      // const args = {};
      // const userCredentials = {
      //   name: username,
      //   address: address,
      //   password: password
      // };

      // try {
      //   yield externalStorage.uploadContract(userCredentials, args);
      // } catch (error) {
      //   console.warn('appMetadata contract upload error:', error);
      // }

      // will return contractAddress, Uri, metadata
      res.status(200).json({ contractAddress: "0xsdfsdf", uri: 'uri of the video', metadata: 'a sample video on s3' });
    });
  },

  verify: function (req, res, next) {
    const dataBlob = req.body.dataBlob;
    const contractAddress = req.body.contractAddress;

    if (!contractAddress && !dataBlob) {
      let err = new Error('something went wrong');
      err.status = 400;
      return next(err);
    }

    // will returns isValid, Uri of the video, timestamp and signers
    res.status(200).json({ isValid: true, uri: 'uri of the video', timestamp: '', signers: [{}] });
  },

  attest: function (req, res, next) {
    const contractAddress = req.query.contractAddress;

    if (!contractAddress) {
      let err = new Error('something went wrong');
      err.status = 400;
      return next(err);
    }

    // will returns a list of signers of the uploaded resource
    res.status(200).json({ signers: [], message: 'returns a list of signers of the uploaded resource' });
  },

  download: function (req, res, next) {
    co(function* () {
      const contractAddress = req.query.contractAddress;

      if (!contractAddress) {
        let err = new Error('something went wrong');
        err.status = 400;
        return next(err);
      }

      // TODO: Will get fileName form contract
      var options = {
        Bucket: appConfig.s3.bucket.Bucket,
        Key: '1528717272380-soap-bubble-1958650_960_720.jpg',
      };

      res.attachment(options.Key);
      var fileStream = s3.getObject(options).createReadStream();
      fileStream.pipe(res);

      // Download file URI using contractAddress as a request
      res.status(200).json({ resource: 'URI Of the image or video etc', metadata: 'top secret file stored on s3 and tracked on blockchain' });
    })
  }
};
