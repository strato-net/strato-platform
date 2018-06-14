/* jshint esnext: true */
const bcrypt = require('bcrypt');
const blockappsRest = require('blockapps-rest').rest;
const co = require('co');

const appConfig = require('../config/app.config');
const models = require('../models');
const s3 = require('../lib/s3');
const externalStorage = require('../lib/externalStorage/externalStorage');
const crypto = require('crypto');

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

      var params = {
        Bucket: appConfig.s3.bucket.Bucket,
        Key: `${Date.now()}-${req.file.originalname}`,
        Body: req.file.buffer,
      };

      const hash = crypto.createHmac('sha256', req.file.buffer).digest('hex');

      // s3.upload(params, function (err, data) {
      //   if (err) {
      //     console.log('error in callback');
      //     console.log(err);
      //   }
      //   console.log('success');
      //   console.log(data);
      // });

      // const args = {
      //   _uri: req.file.originalname,
      //   _host: provider,
      //   _hash: '0x12345678'
      // };

      // const userCredentials = {
      //   name: username,
      //   address: address,
      //   password: password
      // };

      // try {
      //   let temp = yield externalStorage.uploadContract(userCredentials, args);
      //   console.log("---------------------------", temp)
      // } catch (error) {
      //   console.log('-------------------------------');
      //   console.warn('externalstorage contract upload error:', error);
      // }

      res.status(200).json({ contractAddress: req.body });
      // res.status(200).json({ contractAddress: "0xsdfsdf", uri: 'uri of the video', metadata: 'a sample video on s3' });
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

      // if (!contractAddress) {
      //   let err = new Error('something went wrong');
      //   err.status = 400;
      //   return next(err);
      // }

      // TODO: Will get fileName form contract
      var options = {
        Bucket: appConfig.s3.bucket.Bucket,
        Key: '1528970375737-SampleVideo_1280x720_1mb.flv',
      };

      res.attachment(options.Key);
      var fileStream = s3.getObject(options).createReadStream();
      fileStream.pipe(res);
    })
  }
};
