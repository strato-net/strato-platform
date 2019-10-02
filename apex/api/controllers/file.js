/* jshint esnext: true */
const co = require('co');

const appConfig = require('../config/app.config');
const models = require('../models');
const s3 = require('../lib/s3');
const uploader = require('../lib/uploader');
const externalStorage = require('../lib/externalStorage/externalStorage');
const crypto = require('crypto');
var rp = require('request-promise');

const RestStatus = require(`${process.cwd()}/lib/rest-utils/rest-constants`);

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
        err.status = RestStatus.BAD_REQUEST;
        return next(err);
      }

      var params = {
        Bucket: appConfig.s3.bucket.Bucket,
        Key: `${Date.now()}-${req.file.originalname}`,
        Body: req.file.buffer,
      };

      // Checking if the username/password pair is correct
      // TODO: this is the only way to find out if credentials are correct but it costs some wei - change this request once there's another way in our APIs
      const options = {
        method: 'POST',
        uri: `${process.env.blocRoot}/users/${username}/${address}/send?resolve`,
        body: {
          value: 1,
          password: password,
          toAddress: address
        },
        json: true
      };

      try {
        yield rp.post(options);
      } catch (error) {
        let err = new Error('Unable to verify username/password pair');
        err.status = RestStatus.BAD_REQUEST;
        return next(err);
      }

      let uploadedFile;
      
      try {
        uploadedFile = yield uploader.upload(params);
      } catch (error) {
        let err = new Error(`AWS S3 upload file to bucket error: ${JSON.stringify(error)}`);
        err.status = RestStatus.INTERNAL_SERVER_ERROR;
        return next(err);
      }
      
      try {
        const args = {
          _fileKey: uploadedFile.Key,
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

        const contractUpload = yield externalStorage.uploadContract(userCredentials, args);

        yield models.Upload.create({
          contractAddress: contractUpload.address,
          uri: uploadedFile.Location,
          hash: hash
        });

        res.status(RestStatus.OK).json({ contractAddress: contractUpload.address, fileKey: uploadedFile.Key, uri: uploadedFile.Location, metadata: metadata });
      } catch (error) {
        let err = new Error(error);
        err.status = RestStatus.INTERNAL_SERVER_ERROR;
        return next(err);
      };
    });
  },

  list: function (req, res, next) {
    co(function* () {
      const uploads = yield models.Upload.all({
        attributes: ['contractAddress', 'uri', 'hash', 'createdAt']
      });
      res.status(RestStatus.OK).json({ list: uploads });
    });
  },

  verify: function (req, res, next) {
    co(function* () {
      const contractAddress = req.query.contractAddress;

      if (!contractAddress) {
        let err = new Error('wrong params, expected: {contractAddress}');
        err.status = RestStatus.BAD_REQUEST;
        return next(err);
      }

      const record = yield models.Upload.findOne({
        where: { contractAddress: contractAddress },
      });

      if (!record) {
        let err = new Error('Address not found');
        err.status = RestStatus.BAD_REQUEST;
        return next(err);
      }

      try {
        const data = yield externalStorage.getExternalStorage(contractAddress);
        res.status(RestStatus.OK).json({ uri: data.uri, timeStamp: data.timeStamp, signers: data.signers });
      } catch (error) {
        let err = new Error(error);
        err.status = RestStatus.INTERNAL_SERVER_ERROR;
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

      if (!contractAddress || !username || !password || !address) {
        let err = new Error('wrong params, expected: {username, password, address, contractAddress}');
        err.status = RestStatus.BAD_REQUEST;
        return next(err);
      }

      const record = yield models.Upload.findOne({
        where: { contractAddress: contractAddress },
      });

      if (!record) {
        let err = new Error('Contract address not found');
        err.status = RestStatus.BAD_REQUEST;
        return next(err);
      }

      const args = {};
      const userCredentials = {
        name: username,
        address: address,
        password: password
      };

      try {
        const result = yield externalStorage.getExternalStorage(contractAddress);

        if (result.signers.indexOf(address) > -1) {
          let err = new Error('You already signed this transaction');
          err.status = RestStatus.BAD_REQUEST;
          return next(err);
        } else {
          const data = yield externalStorage.attest(userCredentials, contractAddress, args);
          res.status(RestStatus.OK).json({ attested: true, signers: data[0] });
        }

      } catch (error) {
        let err = new Error(error);
        err.status = RestStatus.INTERNAL_SERVER_ERROR;
        return next(err);
      }
    });
  },

  download: function (req, res, next) {
    co(function* () {
      const contractAddress = req.query.contractAddress;

      if (!contractAddress) {
        let err = new Error('wrong params, expected: {contractAddress}');
        err.status = RestStatus.BAD_REQUEST;
        return next(err);
      }

      const record = yield models.Upload.findOne({
        where: { contractAddress: contractAddress },
      });

      if (!record) {
        let err = new Error('Address not found');
        err.status = RestStatus.BAD_REQUEST;
        return next(err);
      }

      try {
        const data = yield externalStorage.getExternalStorage(contractAddress);

        var options = {
          Bucket: appConfig.s3.bucket.Bucket,
          // Keeping the 2nd part (using data.uri) for backwards-compatibility with older ExternalStorage contracts on the blockchain (for nodes upgraded from pre-4.5.1)
          Key: data.fileKey || /[^/]*$/.exec(data.uri)[0],
          Expires: 3600
        };

        const url = s3.getSignedUrl('getObject', options);
        res.status(RestStatus.OK).json({ url: url });

      } catch (error) {
        let err = new Error(error);
        err.status = RestStatus.INTERNAL_SERVER_ERROR;
        return next(err);
      }

    })
  }
};
