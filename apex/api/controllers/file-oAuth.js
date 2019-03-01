/* jshint esnext: true */
const co = require('co');

const appConfig = require('../config/app.config');
const models = require('../models');
const s3 = require('../lib/s3');
const uploader = require('../lib/uploader');
const externalStorage = require('../lib/externalStorage/externalStorage');
const crypto = require('crypto');
const rp = require('request-promise');

const ax = require(`${process.cwd()}/lib/rest-utils/axios-wrapper`);
const RestStatus = require(`${process.cwd()}/lib/rest-utils/rest-constants`);

//todo - probably need to do oauth version of file && externalStorage

module.exports = {
  upload: function (req, res, next) {
    co(function* () {
      const content = req.body.content;
      const provider = req.body.provider;
      const metadata = req.body.metadata;


      const uID = req.headers['x-user-unique-name'];
      const uHash = req.headers['x-user-id'];

      const hash = crypto.createHmac('sha256', req.file.buffer).digest('hex');

      if (!uID || !uHash ) { //fixme - is this check needed?
        let err = new Error('wrong headers, expected: {x-user-unique-name, x-user-id}'); //fixme - there must be a better way .jpg
        err.status = RestStatus.UNAUTHORIZED;
        return next(err);
      }

      if (!metadata || !provider ) {
        let err = new Error('wrong params, expected: {provider, metadata}');
        err.status = RestStatus.BAD_REQUEST;
        return next(err);
      }

      const params = {
        Bucket: appConfig.s3.bucket.Bucket,
        Key: `${Date.now()}-${req.file.originalname}`,
        Body: req.file.buffer,
      };


      try {
        const uploadedFile = yield uploader.upload(params);

        const args = {
          _uri: uploadedFile.Location,
          _host: provider,
          _hash: hash,
          _metadata: metadata,
          _uID: uID,
          _uHash: uHash
        };

        const userCredentials = {
          'x-user-unique-name':req.headers['x-user-unique-name'],
          'x-user-id': req.headers['x-user-id']
        };

        const contractUpload = yield externalStorage.uploadContract(userCredentials, args);

        yield models.Upload.create({
          contractAddress: contractUpload.address,
          uri: uploadedFile.Location,
          hash: hash
        });

        res.status(RestStatus.OK).json({ contractAddress: contractUpload.address, uri: uploadedFile.Location, metadata: metadata });
      } catch (error) {
        console.log(error)
        let err = new Error(error);
        err.status = RestStatus.INTERNAL_SERVER_ERROR;
        return next(err);
      };
    });
  },

  list: function (req, res, next) {
    //todo - check x-user* headers
    co(function* () {
      const uploads = yield models.Upload.all({
        attributes: ['contractAddress', 'uri', 'hash', 'createdAt']
      });
      res.status(RestStatus.OK).json({ list: uploads });
    });
  },

  verify: function (req, res, next) {
    //todo - check x-user* headers
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


      const uID = req.headers['x-user-unique-name'];
      const uHash = req.headers['x-user-id'];

      if (!uID || !uHash ) { //fixme - is this check needed?
        let err = new Error('wrong headers, expected: {x-user-unique-name, x-user-id}');
        err.status = RestStatus.UNAUTHORIZED;
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
        'x-user-unique-name':req.headers['x-user-unique-name'],
        'x-user-id': req.headers['x-user-id']
      };

      try {
        const result = yield externalStorage.getExternalStorage(contractAddress);

        const blocUser = yield ax.get(process.env.VAULT_HOST, `/strato/v2.3/key`, userCredentials);

        if (result.signers.indexOf(blocUser.address) > -1) {
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
          Key: /[^/]*$/.exec(data.uri)[0],
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
