var fs = require('fs');
var Solidity = require('blockapps-js').Solidity;
var rp = require('request-promise');
var path = require('path');
var mkdirp = require('mkdirp');
var chalk = require('chalk');
var yamlConfig = require('./yaml-config');
var fs = require('fs');

function compileSol(solSrc) {
  var compile;
  if(solSrc.source || solSrc.searchable) {
    compile = Solidity(solSrc.source);
  } else {
    compile = Solidity(solSrc);
  }
  return compile.then(function(solObj) {
    var multi = false;
    var dirs = [];

    if (typeof solObj.name === 'undefined' || solObj.name === '') {
      multi = true;
      dirs = Object.keys(solObj.src).map(function (contract) {
        return path.join('app','meta', contract);
      });
    } else {
      dirs.push(path.join('app','meta', solObj.name));
    }

    // console.log(chalk.yellow("Compile successful: " + solSrc));

    var theObj = {};

    /* unify object schemas */

    if (multi) {
      theObj = solObj;
    } else {
      var name = solObj.name;
      var innerObj = {};

      innerObj[name] = solObj;
      theObj['src'] = innerObj;
    }
    dirs.map(function(contractPath) {
      mkdirp.sync(contractPath);

      //use this to prevent unnecessary posts to create table
      var contractNameInPath = contractPath.slice(contractPath.lastIndexOf('/')+1)
      for (contractName in theObj.src) {
        var contract = theObj.src[contractName];
        var multiPath = path.join(contractPath, contractName + '.json');

        console.log("writing " + contractName + " to " + multiPath)
        fs.writeFileSync(multiPath, contract.detach());

        console.log(chalk.green("wrote: ") + multiPath);

        if(solSrc.searchable) {
          var detached = contract.detach();
          for(var i=0; i < solSrc.searchable.length; i++){
            // only if writing to folder of contractNameInPath do we attempt to make the table
            if(solSrc.searchable[i] === contractNameInPath && solSrc.searchable[i] === contractName) {
              //BEWARE: removing strato-api from apiUrl. Likely need a cirrusUrl
              //field in config.yaml.
              var apiUrl = 'http://' + (process.env.CIRRUS || 'cirrus:3333');
              var options = {
                method: 'POST',
                uri: apiUrl,
                body: detached,
                headers: {
                  'Content-Type': 'application/json'
                }
              };
              rp(options).then(function(_){
                console.log('Successfully created table in cirrus for contract ');
              })
              .catch(function(err){
                console.log('Error Creating table in cirrus: ', err);
              });
            }
          }
        }
      }
    });
    return theObj;
  }).
  catch(function(e) {
    console.log("compile failed with error message: " + e);
    throw(e);
  });
}

module.exports = compileSol;
