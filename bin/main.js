#!/usr/bin/env node
'use strict'

var request = require('request');
var Promise = require('bluebird');
var fs = require('fs');
var path = require('path');
var spawn = require('child_process').spawn;
var prompt = Promise.promisifyAll(require('prompt'));

var analytics = require('../templates/app/lib/analytics.js');

var cmd = require('../templates/app/lib/cmd.js');
var key = require('../templates/app/lib/keygen');
var scaffold = require('../templates/app/lib/scaffold.js');
var yamlConfig = require('../templates/app/lib/yaml-config.js');

var compile = require('../templates/app/lib/compile.js');
var upload = require('../templates/app/lib/upload.js');

var promptSchema = require('../templates/app/lib/prompt-schema.js');
var requestPassword = require('../templates/app/lib/prompt-schema.js').requestPassword;
var registerPassword = require('../templates/app/lib/prompt-schema.js').registerPassword;
var createPassword = require('../templates/app/lib/prompt-schema.js').createPassword;
var scaffoldApp = require('../templates/app/lib/prompt-schema.js').scaffoldApp;
var transfer = require('../templates/app/lib/prompt-schema.js').transfer;
var helper = require('../templates/app/lib/contract-helpers.js');

require('pkginfo')(module, 'version');

var icon = require('../templates/app/lib/icon.js').blocIcon;

var api = require("blockapps-js");
var Transaction = api.ethbase.Transaction;
var Int = api.ethbase.Int;
var ethValue = api.ethbase.Units.ethValue;
var PrivateKey = api.ethbase.Crypto.PrivateKey;
var lw = require('eth-lightwallet');
var chalk = require('chalk');

var stratoVersion = "1.2"
var config;

function makeConfig(result) {
  var name = result.appName;
  var stat;
  try {
    stat = fs.statSync(name);
  } catch (e) {
  }

  if (stat !== undefined) {
    console.log("project: " + name + " already exists");
  } else {
    scaffold(result.appName, result.developer);

    if ((result.email !== undefined) && (result.email != "")) { 
      var reportObj = {
        initName: result.developer,
        initEmail: result.email,
        initTimestamp:  Math.floor(new Date() / 1000).toString()
      };                    
      console.log("report obj: " + JSON.stringify(reportObj));
      request({ 
        method: "POST",
        uri: "http://strato-license.eastus.cloudapp.azure.com:8081/init",
        headers: {
          "Content-Type": "application/json"
        },
        body:  JSON.stringify(reportObj),
      }, function (err, res, _) { 
        console.log("thanks for registering with BlockApps!");
      });
    }
    
    yamlConfig.writeYaml(result.appName + "/config.yaml", result);   
  }
}

function blocinit(cmdArgv) {
  console.log(icon());

  analytics.insight.trackEvent("init");

  if(cmdArgv && 'appName' in cmdArgv && 'developer' in cmdArgv) {
    var cmdObj = {
      appName: cmdArgv.appName,
      developer: cmdArgv.developer,
      apiURL: cmdArgv.apiURL,
      profile: cmdArgv.profile || "ethereum-frontier"
    }

    if ("email" in cmdArgv) {
      cmdObj.email = cmdArgv.email;
    }

    makeConfig(cmdObj);
  }
  else {
    var cmdArr = cmdArgv._;
    if(cmdArr.length > 1){
      var name = cmdArr.slice(-1)[0];
      scaffoldApp.properties.appName.default = name;
    }
    prompt.start();
    prompt.getAsync(scaffoldApp).then(makeConfig);
  }
  return;
}

function checkForProject() {
  try {
    config = yamlConfig.readYaml('config.yaml');
  } catch (e){
    throw 'Cannot open config.yaml - are you in the project directory?';
  } 
}

function setApiProfile() {
  api.setProfile("ethereum-frontier", config.apiURL, stratoVersion);
}

function main (){
  var cmdArr = cmd.argv._;
  if (cmdArr[0] == "init") {
    if (cmd.argv.optOut) {
      analytics.insight.config.set("optOut", true);
      delete cmd.argv.optOut;
      return blocinit(cmd.argv);
    } else if (cmd.argv.optIn) {
      analytics.insight.config.set("optOut", false);
      delete cmd.argv.optIn;
      return blocinit(cmd.argv);
    } else if(analytics.insight.optOut === undefined){
      return analytics.insight.askPermission( analytics.insight.insightMsg, function(){
        blocinit(cmd.argv);
      });
    } else {
      return blocinit(cmd.argv);
    }
  }
    
  switch(cmdArr[0]) {

    case 'compile':
      analytics.insight.trackEvent("compile");
      checkForProject();
      setApiProfile();
      var solSrcDir = path.join('app', 'contracts');
      var config = yamlConfig.readYaml('config.yaml');

      var solSrcFiles;
      if (cmdArr[1]) {

        var fname = path.parse(cmdArr[1]).ext === '.sol' ?
                                           cmdArr[1] : cmdArr[1] + ".sol";
          // Make sure the file exists
        try {
          fs.accessSync(path.join(solSrcDir,fname), fs.F_OK);
        } catch (e) {
          console.log(chalk.red("ERROR: ") + "Contract not found");
          break;
        }
        console.log(chalk.yellow("Compiling single contract: ") + chalk.white(fname));
        solSrcFiles = [fname];
      }
      else {
        solSrcFiles = fs.readdirSync(solSrcDir).
          filter(function(filename) {
            return path.extname(filename) === '.sol';
          })
      }

      Promise.all(solSrcFiles).
          map(function (filename) {
            return fs.readFileSync(path.join(solSrcDir, filename)).toString()
          }).  
          map(compile);
      break;

    case 'upload':
      analytics.insight.trackEvent("upload");
      checkForProject();
      setApiProfile();
      var contractName = cmdArr[1];
      cmdArr = cmdArr.slice(2);
      if (contractName === undefined) {
        console.log(chalk.red("ERROR: ") + "Contract name required");
        break;
      }

      var userName = cmd.argv.u;
      var address = cmd.argv.a;

      var keyStream;
      if (address === undefined) { 
        keyStream = helper.userKeysStream(userName);
        if (!keyStream) {
          console.log(chalk.red("ERROR: Key Not Found"));
          console.log(chalk.yellow("Try command: ") + "bloc genkey");
          return;
        }
      } else { 
        keyStream = helper.userKeysAddressStream(userName,address);
      }

      var argObj;
      if (cmdArr.length > 0) {
        argObj = cmdArr;
      }
      else {
        argObj = cmd.argv;
      }
        
      keyStream
          .pipe(helper.collect())
          .on('data', function (data) { 
            var store = lw.keystore.deserialize(JSON.stringify(data[0]));
            var address = store.addresses[0];

            console.log("address: " + address);
            prompt.start();
            prompt.getAsync(requestPassword).then(function(result) {
              var privkey = store.exportPrivateKey(address, result.password);
              return [contractName, privkey, argObj];
            })
               .spread(upload)
               .then(function (_) {
                 console.log("creating metadata for " + contractName);
               });      
          })
        
      break;

    case 'genkey':
      analytics.insight.trackEvent("genkey");
      checkForProject();
      setApiProfile();

      var userName = cmdArr[1];

      prompt.start();
      prompt.getAsync(createPassword).get("password").then(function(password) {
        if (userName === undefined)
          key.generateKey(password,'admin');
        else key.generateKey(password,userName); 
      });
      break;

    case 'register':
      analytics.insight.trackEvent("register");
      checkForProject();
      setApiProfile();

      prompt.start();
      prompt.getAsync(registerPassword).get("password").then(function(password) {
        var loginObj = {
          "email": config.email,
          "app": config.appName,
          "loginpass": password
        };
        var appObj = {
          "developer": config.developer,
          "appurl": config.appURL,
          "repourl": config.repo
        };
        return api.routes.register(loginObj, appObj);
      }).tap(function() {
        console.log("registered, confirm via email")
      });
      break;

    case 'send':
      analytics.insight.trackEvent("send");
      checkForProject();
      setApiProfile();
      var config = yamlConfig.readYaml('config.yaml');
      var transferObj = transfer;

      var userName = cmd.argv.u;
      var address = cmd.argv.a;

      var keyStream;
      if (address === undefined) { 
        keyStream = helper.userKeysStream(userName);
      } else { 
        keyStream = helper.userKeysAddressStream(userName,address);
      }

      keyStream
          .pipe(helper.collect())
          .on('data', function (data) { 
            var store = lw.keystore.deserialize(JSON.stringify(data[0]));

            prompt.start();
            prompt.get(transferObj, function(err,result) {
              prompt.get(promptSchema.confirmTransfer(result), function(err2, _) {

                var address;
                var privkeyFrom;
                if (store) {
                  address = store.addresses[0];
                  privkeyFrom = store.exportPrivateKey(address, result.password);
                }
                else {
                  privkeyFrom = PrivateKey.fromMnemonic(result.password);
                  address = privkeyFrom.toAddress();
                }

                var valueTX = Transaction({"value" : ethValue(result.value).in(result.unit), 
                                               "gasLimit" : Int(result.gasLimit),
                                               "gasPrice" : Int(result.gasPrice)});

                var addressTo = result.to;

                valueTX.send(privkeyFrom, addressTo).then(function(txResult) {
                  console.log("transaction result: " + txResult.message);
                });                 
              });
            });
          });
      break;

    case 'start':
      analytics.insight.trackEvent("start");
      checkForProject();
      setApiProfile();

      // check if `npm install` was run - there might be a better way but this is a start
      try {
        fs.statSync('./node_modules');
      } catch(e) {
        console.log(chalk.red("ERROR: ") + "Please run `npm install`.");
        //console.log("err: " + e)
        break;
      }

      var server = spawn('node', [ 'app.js' ]);

      server.on('error', function (err) {
        throw err;
      }); 

      server.stdout.on('data', function(data) {
        console.log(data.toString("utf-8"));
      });
      
      break;

    case 'version':
      analytics.insight.trackEvent("version");
      console.log("bloc version " + module.exports.version);
      break;

    default:
      console.log("Unrecognized command, try bloc --help");
  }
}

if (require.main === module) {
  main();
}
