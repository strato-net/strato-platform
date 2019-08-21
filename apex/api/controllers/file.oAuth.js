/* jshint esnext: true */

const crypto = require('crypto');

const appConfig = require('../config/app.config');
const ax = require(`${process.cwd()}/lib/rest-utils/axios-wrapper`);
const externalStorage = require('../lib/externalStorage/externalStorage.oAuth');
const RestStatus = require(`${process.cwd()}/lib/rest-utils/rest-constants`);
const s3 = require('../lib/s3');
const uploader = require('../lib/uploader');


async function upload(req, res, next) {
  const provider = req.body.provider;
  const metadata = req.body.metadata;

  const uID = req.headers['x-user-unique-name'];

  if (!metadata || !provider ) {
    let err = new Error('wrong body params, expected: {provider, metadata}');
    err.status = RestStatus.BAD_REQUEST;
    return next(err);
  }

  if (!req.file ) {
    let err = new Error('file missing');
    err.status = RestStatus.BAD_REQUEST;
    return next(err);
  }

  const hash = crypto.createHmac('sha256', req.file.buffer).digest('hex');

  const params = {
    Bucket: appConfig.s3.bucket.Bucket,
    Key: `${Date.now()}-${req.file.originalname}`,
    Body: req.file.buffer,
  };

  let uploadedFile;
  
  try {
    uploadedFile = await uploader.upload(params);
  } catch (error) {
    let err = new Error(`AWS S3 upload file to bucket error: ${JSON.stringify(error)}`);
    console.error(err);
    err.status = RestStatus.INTERNAL_SERVER_ERROR;
    return next(err);
  }
  
  try {
    const args = {
      _fileKey: uploadedFile.Key,
      _uri: uploadedFile.Location,
      _host: provider,
      _hash: hash,
      _metadata: metadata,
      _uID: uID,
    };

    const userCredentials = {
      'x-user-unique-name': uID,
    };

    const contractUpload = await externalStorage.uploadContract(userCredentials, args);

    res.status(RestStatus.OK).json({ contractAddress: contractUpload.address, fileKey: uploadedFile.Key, uri: uploadedFile.Location, metadata: metadata });
  } catch (error) {
    let err = new Error(error);
    console.error(error);
    err.status = RestStatus.INTERNAL_SERVER_ERROR;
    return next(err);
  };
}

async function list(req, res, next) {
  const limit = req.query.limit || 100;
  const offset = req.query.offset || 0;
  try {
    const list = await externalStorage.getExternalStorageList(limit, offset);
    const listFormatted = list.map(f => {
      return {
        'contractAddress': f.address,
        'hash': f.fileHash,
        'fileKey': f.fileKey,
        'uri': f.uri,
        'createdAt': new Date(f.timeStamp*1000).toISOString()
      }
    });
    res.status(RestStatus.OK).json({ list: listFormatted });
  } catch(error) {
    let err = new Error(error);
    console.error(error);
    err.status = RestStatus.INTERNAL_SERVER_ERROR;
    return next(err);
  }
}

async function verify(req, res, next) {
  const contractAddress = req.query.contractAddress;

  if (!contractAddress) {
    let err = new Error('wrong query params, expected: {contractAddress}');
    err.status = RestStatus.BAD_REQUEST;
    return next(err);
  }

  try {
    if (! await externalStorage.checkExternalStorageExists(contractAddress)) {
      let err = new Error('Contract address not found');
        err.status = RestStatus.BAD_REQUEST;
        return next(err);
    }
    const data = await externalStorage.getExternalStorage(contractAddress);
    res.status(RestStatus.OK).json({ uri: data.uri, timeStamp: data.timeStamp, signers: data.signers });
  } catch (error) {
    let err = new Error(error);
    console.error(err);
    err.status = RestStatus.INTERNAL_SERVER_ERROR;
    return next(err);
  }
}

async function attest(req, res, next) {
  const contractAddress = req.body.contractAddress;
  
  const uID = req.headers['x-user-unique-name'];

  if (!contractAddress) {
    let err = new Error('wrong body params, expected: {contractAddress}');
    err.status = RestStatus.BAD_REQUEST;
    return next(err);
  }

  const args = {};
  const userCredentials = {
    'x-user-unique-name': uID,
  };

  try {
    if (! await externalStorage.checkExternalStorageExists(contractAddress)) {
      let err = new Error('Contract address not found');
      err.status = RestStatus.BAD_REQUEST;
      return next(err);
    }
    const result = await externalStorage.getExternalStorage(contractAddress);
    const account = await ax.get(process.env.vaultWrapperHttpHost, `/strato/v2.3/key`, userCredentials);
    if (result.signers.indexOf(account.address) > -1) {
      let err = new Error('You already signed this transaction');
      err.status = RestStatus.BAD_REQUEST;
      return next(err);
    } else {
      const data = await externalStorage.attest(userCredentials, contractAddress, args);
      res.status(RestStatus.OK).json({ attested: true, signers: data[0] });
    }

  } catch (error) {
    let err = new Error(error);
    console.error(err);
    err.status = RestStatus.INTERNAL_SERVER_ERROR;
    return next(err);
  }
}

async function download(req, res, next) {
  const contractAddress = req.query.contractAddress;

  if (!contractAddress) {
    let err = new Error('wrong query params, expected: {contractAddress}');
    err.status = RestStatus.BAD_REQUEST;
    return next(err);
  }

  try {
    if (! await externalStorage.checkExternalStorageExists(contractAddress)) {
      let err = new Error('Contract address not found');
      err.status = RestStatus.BAD_REQUEST;
      return next(err);
    }
    const data = await externalStorage.getExternalStorage(contractAddress);

    const options = {
      Bucket: appConfig.s3.bucket.Bucket,
      Key: data.fileKey,
      Expires: 3600
    };

    const url = s3.getSignedUrl('getObject', options);
    res.status(RestStatus.OK).json({ url: url });

  } catch (error) {
    console.error('Could not get signed url from S3: \n' + error);
    let err = new Error(error);
    err.status = RestStatus.INTERNAL_SERVER_ERROR;
    return next(err);
  }
}

module.exports = {
  attest,
  download,
  list,
  upload,
  verify,
};
