/* jshint esnext: true */

const admZip = require('adm-zip');
const blockappsRest = require('blockapps-rest').rest;
const co = require('co');
const download = require('download');
const fs = require('fs-extra');
const md5File = require('md5-file/promise');
const multer  = require('multer');
const path = require('path');
const rp = require('request-promise');

const appConfig = require('../config/app.config');
const appMetadata = require('../lib/appMetadata/appMetadata');

const tmpFolder = 'tmp';


/**
 * Parse the solidity source
 * @param data {string}
 * @returns {Promise}
 */
parseContractData = function(data) {
  // todo: find another way (using solc.js) or change bloc endpoint to have an option to make ALL contracts searchable instead of listing by one
  const options = {
    method: 'POST',
    uri: `${process.env.stratoRoot}/extabi`,
    headers: {
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: "src="+encodeURIComponent(data),
    json: true
  };

  return rp(options);
};

/**
 * Compile the file
 * @param directory {string}
 * @param fileName {string}
 * @returns {Promise}
 */
checkFileCompiles = function(directory, fileName) {
  return new Promise(function(resolve, reject) {
    const filePath = path.join(directory, fileName);
    fs.readFile(filePath, 'utf8', function (error, data) {
      if (error) {
        console.error(error);
        return next(new Error('could not read the contract file contracts/' + fileName));
      }

      co(function* () {
        const parsedData = yield parseContractData(data);
        const contractNames = Object.keys(parsedData.src);
        const compilationResult = yield blockappsRest.compile(
          [
            {
              "contractName": contractNames[0],
              "searchable": contractNames,
              "source": data
            }
          ]
        );
        console.log(compilationResult); // [0 => {codeHash: "<hash>", contractName = "SimpleStorage"}, ...]
        return resolve(compilationResult);
      }).catch(error => {
        // could not compile one of the contracts
        console.log('could not compile contract', fileName, error);
        return reject(fileName);
      });
    });
  });
};

/**
 * Register the dapp on the blockchain
 * @param username String
 * @param address String
 * @param password String
 * @param packageMetadata Object - parsed metadata
 * @param hash - the md5 hash of the zip file
 * @param host - the externally reachable host (IP or domain name) of current STRATO node machine
 * @returns contract state
 */
registerDapp = function*(username, address, password, packageMetadata, hash, host) {
  const args = {
    _appName: packageMetadata.name,
    _version: packageMetadata.version,
    _description: packageMetadata.description,
    _maintainer: packageMetadata.maintainer,
    _hash: hash,
    _host: host,
  };
  const userCredentials = {
    name: username,
    address: address,
    password: password,
  };
  try {
    return yield appMetadata.uploadContract(userCredentials, args);
  } catch (error) {
    console.warn('appMetadata contract upload error:', error);
    let err = new Error('could not register application on the blockchain');
    // the only possible error handling for current bloc errors
    switch (error.status) {
      case 404:
        err.message += ': wrong username or address';
        err.status = 401;
        break;
      case 400:
        if (error.data === 'incorrect password') {
          err.message += ': incorrect password';
          err.status = 401;
        } else if (error.data.includes('no user found with name')) {
          err.message += ': user does not exist on the node';
          err.status = 401;
        } else if (error.data.includes('address does not exist for user')) {
          err.message += ': wrong address provided for the user';
          err.status = 401;
        } else if (error.data === 'strato error: failed to find account') {
          err.message += ': account does not have any ether';
          err.status = 400;
        }
        // TODO: check if user has not enough ether (e.g. just few wei)
        break;
    }
    throw(err);
  }
};

/**
 * Fetch the dapp metadata from the metadata.json of the package
 * @param packageTmpFolder
 * @returns {Promise}
 */
parsePackageMetadata = function(packageTmpFolder) {
  return new Promise(function(resolve, reject) {
    try {
      fs.readFile(path.join(packageTmpFolder, 'metadata.json'), 'utf8', function (err, data) {
        if (err) {
          throw err;
        }
        try {
          const metadata = JSON.parse(data);
          validatePackageMetadata(metadata);
          return resolve(metadata);
        } catch (error) {
          let err = new Error('could not parse metadata.json: ' + error);
          err.status = 400;
          return reject(err);
        }
      });
    } catch(err) {
      console.error(err);
      return reject(new Error('could not read the metadata.json'));
    }
  });
};

/**
 * Validate the metadata.json parameters
 * @param metadata Object - the parsed JSON object of metadata.json contents
 */
validatePackageMetadata = function(metadata) {
  if (!metadata.name || !metadata.version || !metadata.description || !metadata.maintainer) {
    throw 'wrong params, expected: {name, version, description, maintainer}';
  }
  const appNameRegexp = /^[^|;,!@#$()<>\/\\"'`~{}\[\]=&^]+$/;
  if(appNameRegexp.exec(metadata.name) === null) {
    throw "application name can not contain characters: invalid characters in application name";
  }
};

/**
 * Validate the archive package file structure
 * @param packageFolderPath String - the path of the unzipped package
 */
validatePackageStructure = function*(packageFolderPath) {
  // Checking unexpected files
  const unexpectedRootPaths = [
    '_dapp.zip'
  ];
  const unexpectedFullPaths = unexpectedRootPaths.map(p => path.join(packageFolderPath, p));
  const unexpectedSemaphores = yield Promise.all(unexpectedFullPaths.map(path => fs.pathExists(path)));
  unexpectedSemaphores.forEach((value, index) => {
    if (value) {
      let err = new Error(`the path should not exist in the root of archive: '${unexpectedRootPaths[index]}', please check the archive contents`);
      err.status = 400;
      throw err;
    }
  });

  // Checking required files
  const requiredRootPaths = [
    'metadata.json',
    'index.html',
    'contracts'
  ];
  const requiredFullPaths = requiredRootPaths.map(p => path.join(packageFolderPath, p));
  const requiredSemaphores = yield Promise.all(requiredFullPaths.map(path => fs.pathExists(path)));
  requiredSemaphores.forEach((value, index) => {
    if (!value) {
      let err = new Error(`could not find the path in the root of archive: '${requiredRootPaths[index]}', please check your archive root contents`);
      err.status = 400;
      throw err;
    }
  });
};

/**
 * Remove files or directories if they exist
 * @param paths String|Array - the absolute or relative (to apex/api/) path of the file
 */
removePathsIfExist = function(paths) {
  if (typeof paths === 'string') {
    paths = [paths];
  }
  paths.forEach(path => {
    fs.remove(path)
      .then(() => {
        console.log(`path ${path} is successfully removed or did not exist`);
      })
      .catch(err => {
        console.error(`could not remove path: ${path}`, err);
      });
  });
};

/**
 * Get md5 hash of the file by file path (absolute or relative to apex/api folder)
 * @param filePath
 * @returns {Promise}
 */
getFileHash = function(filePath) {
  return md5File(filePath);
};

/**
 * Validate external host
 * @param externalHost, string
 */
validateExternalHost = function(externalHost) {
  if (process.env.SINGLE_NODE !== "true" && externalHost === 'localhost') {
    let err = new Error(`cannot deploy the dApp from localhost when running multinode - please provide external node host when running your STRATO instance`);
    err.status = 400;
    throw err;
  }
  // TODO: some other validations to make sure IP is external or reachable over the local network somehow (for possible local network STRATO setup)
};

/**
 * Get App Metadata from blockchain by app hash
 * @param hash
 * @returns {Promise} array
 */
getAppMetadataByHash = function(hash) {
  return blockappsRest.query(`AppMetadata?hash=eq.${hash}`);
};

/**
 * Unzip the zip archive with a promise
 * @param filePath
 * @param destination
 * @param overwrite boolean
 * @returns {Promise}
 */
unzip = function(filePath, destination, overwrite) {
  return new Promise(function(resolve, reject) {
    const zip = new admZip(filePath);
    zip.extractAllToAsync(destination, overwrite, function(error) {
      if (error) {
        return reject(error);
      } else {
        return resolve();
      }
    });
  });
};

/**
 * ExpressJS route controller to upload the dApp
 * @param req
 * @param res
 * @param next
 */
upload = function (req, res, next) {
  let tempPaths = [];
  const upload = multer(
    {
      dest: 'uploads/',
      fileFilter: function (req, file, cb) {
        const filetypes = /zip/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

        // TODO: validate mimetype by file content

        if (mimetype && extname) {
          return cb(null, true);
        }
        cb("Error: File upload only supports the following filetypes: " + filetypes);
      },
    }
  );

  upload.single('file')(req, res, function (errorMessage) {
    if (errorMessage) {
      console.warn('file upload failed: ' + errorMessage);
      let err = new Error(errorMessage);
      err.status = 400;
      return next(err);
    }

    const username = req.body.username;
    const address = req.body.address;
    const password = req.body.password;
    const file = req.file;
    if (!file) {
      let err = new Error("wrong params, expected: {username, address, password, file}");
      err.status = 400;
      return next(err);
    }
    tempPaths.push(req.file.path);
    if (!username || !address || !password) {
      removePathsIfExist(tempPaths);
      let err = new Error("wrong params, expected: {username, address, password, file}");
      err.status = 400;
      return next(err);
    }

    // TODO: check if there are any ways to validate username-address-password
    // bunch for validity before processing the package and compiling contracts
    // from it - currently we can only validate when we compile contracts with
    // bloc.

    co(function* () {
      const zipHash = yield getFileHash(file.path);
      const appsMetadataArray = yield getAppMetadataByHash(zipHash);
      if (appsMetadataArray.length) {
        removePathsIfExist(tempPaths);
        let err = new Error(`dapp package provided already exists on the blockchain: /apps/${appsMetadataArray[0].hash}`);
        err.status = 409;
        return next(err);
      }
      // unpack files to tmp folder
      const packageTmpFolder = path.join(tmpFolder,file.filename);
      try {
        yield unzip(file.path, packageTmpFolder, true);
      } catch (error) {
        removePathsIfExist(tempPaths);
        let err = new Error('unable to unzip the package');
        err.status = 400;
        return next(err);
      }

      tempPaths.push(packageTmpFolder);

      yield validatePackageStructure(packageTmpFolder);
      const packageMetadata = yield parsePackageMetadata(packageTmpFolder);

      // check if all contracts from tmp/contracts/ are compile
      const contractsTmpFolder = path.join(packageTmpFolder, 'contracts');
      let files;
      try {
        files = yield fs.readdir(contractsTmpFolder);
      } catch(error) {
        removePathsIfExist(tempPaths);
        let err = new Error('could not read the contracts/ directory of the package');
        err.status = 400;
        return next(err);
      }

      let compilationPromises = [];
      files.forEach(function (fileName, index) {
        compilationPromises.push(checkFileCompiles(contractsTmpFolder, fileName));
      });

      // TODO: refactor: collect all contracts in single array with one bloc call instead
      // files compilation order is random (no cross-file import statement support)
      try {
        yield Promise.all(compilationPromises); // returns [solFiles[contractsInFile{codeHash, contractName},],]
      } catch(error) {
        removePathsIfExist(tempPaths);
        let err = new Error('unable to compile contract: ' + error);
        err.status = 400;
        return next(err);
      }
      const dappPathArray = [
        appConfig.apps.directory,
        zipHash,
      ];
      const currentHost = process.env.NODE_HOST;
      validateExternalHost(currentHost);

      const dappUrl = `http://${currentHost}/${dappPathArray.join('/')}`;

      // Register the dApp prior to moving the files (to prevent overriting the prev version of the user's app in same folder if register will fail)
      yield registerDapp(username, address, password, packageMetadata, zipHash, currentHost);
      // Put _dapp.zip in package folder to be reachable to other nodes in network
      yield fs.move(file.path, path.join(packageTmpFolder, '_dapp.zip'));
      // Making sure apps folder exists
      yield fs.mkdirp(dappPathArray[0]);
      // Replace the dapp folder with the new one (all older files will be removed)
      yield fs.move(packageTmpFolder, path.join(...dappPathArray), {overwrite: true});
      res.status(200).json({metadata: packageMetadata, url: dappUrl});
      removePathsIfExist(tempPaths);
    }).catch(err => {
        removePathsIfExist(tempPaths);
        return next(err);
    });
  });
};

/**
 * Middleware to download dApp from other node when unavailable on the current
 * @param req
 * @param res
 * @param next
 */
acquireDapp = function(req, res, next) {
  const tellClientToTryAgainLater = () => res.status(202).send();
  const urlArray = req.url.split('/').filter(value => value !== '');
  const appHash = urlArray[0];
  let acquiresInProgress = req.app.locals.acquiresInProgress;
  if (acquiresInProgress[appHash]) {
    return tellClientToTryAgainLater();
  } else {
    co(function* () {
      const appsMetadataArray = yield getAppMetadataByHash(appHash);
      if (!appsMetadataArray || appsMetadataArray.length < 1) {
        let err = new Error('could not find the dApp in the network with the hash provided');
        err.status = 404;
        return next(err);
      } else if (appsMetadataArray.length > 1) {
        // Should never happen (only possible case is if dapp was deployed multiple times at the same moment) // TODO: prevent.
        let err = new Error('more than one application with the same app hash found');
        err.status = 500;
        return next(err);
      } else {
        acquiresInProgress[appHash] = new Date().getTime();
        tellClientToTryAgainLater();
        const appMetadata = appsMetadataArray[0];
        try {
          yield download(`${appMetadata.host}/${appConfig.apps.directory}/${appHash}/_dapp.zip`, 'uploads/cross-node/', {filename: appHash + '.zip'});
          yield unzip(`uploads/cross-node/${appHash}.zip`, path.join(appConfig.apps.directory, appHash), true);
        } catch (err) {
          console.error(err);
          // no way to let client know deployment failed until websocket is used here
        }
        delete acquiresInProgress[appHash];
        removePathsIfExist([`uploads/cross-node/${appHash}.zip`]);
      }
    });
  }
};

module.exports = {
  upload: upload,
  acquireDapp: acquireDapp,
};
