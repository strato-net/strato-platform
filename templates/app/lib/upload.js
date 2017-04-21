'use strict'

var Promise = require('bluebird');
var fs = Promise.promisifyAll(require('fs'));
var Solidity = require('blockapps-js').Solidity;

var path = require('path');
// var contractHelpers = require('./contract-helpers.js')

/**
 * Upload a contract by name.
 * @param {string} The name of the contract
 * @para {string} User's private key
 * @param {object} Constructor arguments
 * @return {array}
 */
function upload(contractName, privkey, argObj, params) {
  var compiledFile = path.join('app', 'meta', contractName, contractName + ".json");

  var id = setInterval(function () { console.log("    ...waiting for transaction to be mined"); }, 2000);

  var toRet = fs.readFileAsync(compiledFile, {encoding:"utf8"}).
    then(Solidity.attach).
    then(function(solObj) {
      var toret;
      if (argObj.constructor === Object) {
        toret = solObj.construct(argObj);
      }
      else {
        toret = solObj.construct.apply(solObj, argObj);
      }
      //console.log("uploading with privKey: " + privkey)
      // We now have handlers.enable == true in routes/users.js
      return toret.txParams(params).callFrom(privkey);
    }).
    then(function(contrObj){
      var addr = contrObj.account.address.toString();
      var uploadedFile = path.join('app', 'meta', contractName, addr + ".json");
      var latestPath = path.join('app', 'meta', contractName, "Latest.json");

      console.log("writing: " + uploadedFile);
      console.log("writing: " + latestPath);
      clearInterval(id);

      var arr = [uploadedFile, latestPath, contrObj.detach(), addr];
      return Promise.join(
        fs.writeFileAsync(arr[0], arr[2]),
        fs.writeFileAsync(arr[1], arr[2])
        ).return(arr);
    })
   .catch(function (err) {
     console.log("there was an error: " + err);
     clearInterval(id);
     Promise.reject(err.toString());
   });

  return toRet;
}

module.exports = upload;
