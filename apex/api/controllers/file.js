/* jshint esnext: true */
const co = require('co');

const appConfig = require('../config/app.config');
const models = require('../models');
const s3 = require('../lib/s3');
const uploader = require('../lib/uploader');
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

      const hash = crypto.createHmac('sha256', req.file.buffer).digest('hex');

      if (!metadata || !provider || !username || !password || !address) {
        let err = new Error('wrong params, expected: {username, password, address, provider, metadata}');
        err.status = 400;
        return next(err);
      }

      var params = {
        Bucket: appConfig.s3.bucket.Bucket,
        Key: `${Date.now()}-${req.file.originalname}`,
        Body: req.file.buffer,
      };

      const uploadedFile = yield uploader.upload(params);

      const args = {
        _uri: uploadedFile.Location,
        _host: provider,
        _hash: hash,
        _metadata: metadata
      };

      const userCredentials = {
        name: username,
        address: address,
        password: password
      };

      try {
        let contractUpload = yield externalStorage.uploadContract(userCredentials, args);
        yield models.Upload.create({
          contractAddress: contractUpload.address,
          uri: uploadedFile.Location,
          hash: hash
        });

        res.status(200).json({ contractAddress: contractUpload.address, uri: uploadedFile.Location, metadata: metadata });
      } catch (error) {
        let err = new Error(error);
        err.status = 500;
        return next(err);
      };
    });
  },

  list: function (req, res, next) {
    co(function* () {
      let uploads = yield models.Upload.all({
        attributes: ['contractAddress', 'uri', 'hash', 'createdAt']
      });
      res.status(200).json({ list: uploads });
    });
  },

  verify: function (req, res, next) {
    co(function* () {
      const contractAddress = req.query.contractAddress;

      if (!contractAddress) {
        let err = new Error('wrong params, expected: {contractAddress}');
        err.status = 400;
        return next(err);
      }

      let record = yield models.Upload.findOne({
        where: { contractAddress: contractAddress },
      });

      if (!record) {
        let err = new Error('Address not found');
        err.status = 400;
        return next(err);
      }

      try {
        let data = yield externalStorage.getExternalStorage(contractAddress);
        res.status(200).json({ uri: data.uri, timeStamp: data.timeStamp, signers: data.signers });
      } catch (error) {
        let err = new Error(error);
        err.status = 500;
        return next(err);
      }
    });
  },

  attest: function (req, res, next) {
    co(function* () {
      const contractAddress = req.body.contractAddress;
      const username = req.body.username;
      const password = req.body.password;
      const address = req.body.address;

      if (!contractAddress && !username && !password && !address) {
        let err = new Error('wrong params, expected: {username, password, address, contractAddress}');
        err.status = 400;
        return next(err);
      }

      let record = yield models.Upload.findOne({
        where: { contractAddress: contractAddress },
      });

      if (!record) {
        let err = new Error('Contract address not found');
        err.status = 400;
        return next(err);
      }

      const args = {};
      const userCredentials = {
        name: username,
        address: address,
        password: password
      };

      try {
        let result = yield externalStorage.getExternalStorage(contractAddress);

        if (result.signers.indexOf(address) > -1) {
          let err = new Error('You already signed this transaction');
          err.status = 400;
          return next(err);
        } else {
          let data = yield externalStorage.attest(userCredentials, contractAddress, args);
          res.status(200).json({ attested: true, signers: data[0] });
        }

      } catch (error) {
        let err = new Error(error);
        err.status = 500;
        return next(err);
      }
    });
  },

  download: function (req, res, next) {
    co(function* () {
      const contractAddress = req.query.contractAddress;

      if (!contractAddress) {
        let err = new Error('wrong params, expected: {contractAddress}');
        err.status = 400;
        return next(err);
      }

      let record = yield models.Upload.findOne({
        where: { contractAddress: contractAddress },
      });

      if (!record) {
        let err = new Error('Address not found');
        err.status = 400;
        return next(err);
      }

      try {
        let data = yield externalStorage.getExternalStorage(contractAddress);

        var options = {
          Bucket: appConfig.s3.bucket.Bucket,
          Key: /[^/]*$/.exec(data.uri)[0],
          Expires: 3600
        };

        const url = s3.getSignedUrl('getObject', options);
        res.status(200).json({ url: url });

      } catch (error) {
        let err = new Error(error);
        err.status = 500;
        return next(err);
      }

    })
  }
};
