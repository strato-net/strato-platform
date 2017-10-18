const admZip = require('adm-zip');
const blockappsRest = require('blockapps-rest').rest;
const co = require('co');
const fs = require('fs');
const mkdirp = require('mkdirp');
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
parseContractData = function*(data) {
  const options = {
    method: 'POST',
    uri: 'http://' + process.env['NODE_HOST']+'/strato-api/eth/v1.2/extabi',
    headers: {
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: "src="+encodeURIComponent(data),
    json: true
  };

  return rp(options)
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
              "contractName": contractNames[0], // todo: check if it's correct
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
      })
    })
  })
};

registerDapp = function*(username, address, password, packageMetadata, dappUrl) {
  const args = {
    _appName: packageMetadata['name'],
    _version: packageMetadata['version'],
    _url: dappUrl,
    _description: packageMetadata['description'],
    _maintainer: packageMetadata['maintainer'],
  };
  const userCredentials = {
    name: username,
    address: address,
    password: password,
  };
  try {
    return yield appMetadata.uploadContract(userCredentials, args);
  } catch (error) {
    let err = new Error('could not register application on the blockchain');
    // TODO: add better error handling for bloc API errors (if it's possible...)
    switch (error.status) {
      case 404:
        err.message += ': wrong username or address';
        err.status = 401;
        break;
      case 400:
        if (error.data === 'incorrect password') {
          err.message += ': incorrect password';
          err.status = 401
        } else if (error.data === 'strato error: failed to find account') {
          err.message += ': account does not have any ether';
          err.status = 400
        }
        break;
    }
    throw(err)
  }
};

parsePackageMetadata = function(packageTmpFolder) {
  return new Promise(function(resolve, reject) {
    fs.readFile(path.join(packageTmpFolder, 'metadata.json'), 'utf8', function (err, data) {
      if (err) {
        console.error(err);
        return reject(new Error('could not read the metadata.json'));
      }
      try {
        const metadata = JSON.parse(data);
        validatePackageMetadata(metadata);
        return resolve(metadata);
      } catch(error) {
        let err = new Error('could not parse metadata.json: ' + error);
        err.status = 400;
        return reject(err)
      }
    });
  });
};

validatePackageMetadata = function(metadata) {
  if (!metadata['name'] || !metadata['version'] || !metadata['description'] || !metadata['maintainer']) {
    throw 'wrong params, expected: {name, version, description, maintainer}'
  }
};

upload = function (req, res, next) {
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
      let err = new Error(errorMessage);
      err.status = 400;
      return next(err);
    }

    const username = req.body.username;
    const address = req.body.address;
    const password = req.body.password;
    const file = req.file;

    if (!username || !address || !password || !file) {
      let err = new Error("wrong params, expected: {username, address, password, file}");
      err.status = 400;
      return next(err);
    }

    // TODO: check if there are any ways to validate username-address-password bunch for validity before processing the package and compiling contracts from it

    // unpack files to tmp folder
    const zip = new admZip(file.path);
    const packageTmpFolder = path.join(tmpFolder,file.filename);

    zip.extractAllToAsync(packageTmpFolder, true, function(error) {
      if (error) {
        let err = new Error('unable to unzip the package');
        err.status = 400;
        return next(err);
      }

      // TODO: validate the file structure of the package (required files, folders), contracts/ contains .sol files only

      // check if all contracts from tmp/contracts/ are compile
      const contractsTmpFolder = path.join(packageTmpFolder, 'contracts');
      fs.readdir(contractsTmpFolder, function(error, files) {
        if (error) {
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
        Promise.all(compilationPromises)
          .then(values => { // values === [solFiles[contractsInFile{codeHash, contractName},],]
            co(function*() {
              // TODO: refactor: move packageMetadata right after unzipping the package to validate before compiling contracts
              let packageMetadata = yield parsePackageMetadata(packageTmpFolder);
              const dappPathArray = [
                appConfig.apps.directory,
                encodeURIComponent(username),
                encodeURIComponent(packageMetadata['name']),
              ];
              const dappUrl = `http://${process.env['NODE_HOST']}/${dappPathArray.join('/')}`;

              // TODO: refactor: move the app files first, then register dapp and clean files if error
              yield registerDapp(username, address, password, packageMetadata, dappUrl);
              // make sure if apps/username folder exists
              mkdirp(path.join(dappPathArray[0], dappPathArray[1]), function (err) {
                if (err) {
                  return next(err);
                }
                fs.rename(packageTmpFolder, path.join(...dappPathArray), function (err) {
                  if (err) {
                    return next(err);
                  }
                  res.status(200).json({metadata: packageMetadata, url: dappUrl});
                });
              });
            }).catch(err => {
              return next(err);
            })
          })
          .catch(error => {
            let err = new Error('unable to compile contract: ' + error);
            err.status = 400;
            return next(err);
          })
      });
    });
  })
};

module.exports = {
    upload: upload,
};