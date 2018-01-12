'use strict';
var path = require('path');                                                                
var yaml = require('js-yaml');
var readdirp = require('readdirp');

var vinylFs = require( 'vinyl-fs' );
var map = require( 'map-stream' );
var stream = require('stream');  
var es = require('event-stream');
var merge = require('deepmerge');
var fs = require('fs');
var api = require('blockapps-js');

var Promise = require("bluebird");
/* utility */
var getContents = function(file, cb) {
  // try{
  cb(null,file.contents);
  // } catch (error) {
  //   console.log("tried reading contents, failed: " + error)
  // }
};

var getPath = function(file, cb) {
  if(file.relative.includes('\\')) {
    var index = file.relative.lastIndexOf('\\');
    var val = file.relative.slice(index+1);
    cb(null,val);
  } else {
    cb(null,file.relative);
  }
};

// var getDir = function(file, cb) {
//   cb(null,file.cwd);    
// };

function contractNameStream(contractName) {
  return vinylFs.src( [ path.join('app', 'meta', contractName + '.json') ] )
      .pipe( map(getContents) );
}

function userNameStream() {
  return vinylFs.src( [ path.join('app', 'users','*') ] )
      .pipe( map(getPath) );
}
/* all contract names, just checking for their presence */
function contractsStream() {
  return vinylFs.src( [ path.join('app', 'contracts', '*.sol') ] )
      .pipe( map(getPath) );  
}

function contractDirsStream() { 
  return readdirp({root: path.join('app','meta'), depth: 1});
}

function contractAddressesStream(name) {
  return vinylFs.src( [ path.join('app', 'meta', name, '*.json') ] )
      .pipe( map(getPath) );  
}

function contractsMetaAddressStream(name, address) { 
  var fileName = path.join('app', 'meta', name, address + '.json');
  var inject = false;
  try {
    console.log("Looking for contract at: " + fileName)
    fs.statSync(fileName);
  } catch(e) {
    console.log("Contract wasn't already uploaded with that address, trying by injecting address");
    inject = true;
    fileName = path.join('app', 'meta', name, "Latest" + '.json');
  }
  try {
    fs.statSync(fileName);
  } catch(e) {
    fileName = path.join('app', 'meta', name, name + '.json');
  }
  try {
    fs.statSync(fileName);
  } catch(e) {
    console.log("Really couldn't find file, aborting: " + fileName);
    return null;
  }

  var vfs = vinylFs.src( [ fileName ] );
  var toRet = vfs
    .pipe( map(getContents) )
    .pipe( es.map(function (data, cb) {
      var parsedData = {};
      try {
        var parsedData = JSON.parse(data)
      } catch (error) {
        console.log("failed parsing data")
      }
      if(inject){
        parsedData["address"] = address;
      }
      cb(null, parsedData);
    }));
  return toRet;
}

/* emits all contract metadata as json */
function contractsMetaStream() { 
  return vinylFs.src( [ path.join('meta', '*.json') ] )
      .pipe( map(getContents) )
      .pipe( es.map(function (data, cb) {
        cb(null, JSON.parse(data))
      }));
}

/* emits config as json */
function configStream() {
  return vinylFs.src( [ './config.yaml' ] )
      .pipe( map(getContents) )
      .pipe( es.map(function (data, cb) {
        cb(null, yaml.safeLoad(data))
      }));
}

/* emit user keys */
function userKeysStream(user) {
  try {
    fs.statSync('./app/users/' + user);
  } catch(e) {
    //console.log("err: " + e)
    return null;
  }
  return vinylFs.src( [ path.join('app', 'users', user, '*.json') ] )
      .pipe( map(getContents) )
      .pipe( es.map(function (data, cb) {
        cb(null, JSON.parse(data))
      }));
}

function userKeysAddressStream(user,address) {
  return vinylFs.src( [ path.join('app', 'users', user, address + '.json') ] )
      .pipe( map(getContents) )
      .pipe( es.map(function (data, cb) {
        cb(null, JSON.parse(data))
      }));
}

/* emit all keys */
function allKeysStream() {
  return vinylFs.src( [ path.join('app', 'users','**','*','*.json') ] )
      .pipe( map(getContents) )
      .pipe( es.map(function (data, cb) {
        cb(null, JSON.parse(data))
      }));
}

// collects a bunch of data, makes an array out of it, and emits it 

function collect() {
  console.log("collect")
  var a = new stream.Stream ()
    , array = [], isDone = false;
 
  a.write = function (l) {
    array.push(l);
  }

  a.end = function () {
    isDone = true;
    this.emit('data', array);
    this.emit('end');
  }

  a.writable = true;
  a.readable = true;

  a.destroy = function () {
    a.writable = a.readable = false;
    
    if (isDone) return;
  }

  return a;
}

function fuseStream() {
  var toFuse = [].slice.call(arguments);
  if (toFuse.length === 1 && (toFuse[0] instanceof Array)) {
    toFuse = toFuse[0];
  }

  var strm = new stream.Stream();
  strm.setMaxListeners(0);

  var endCount = 0;
  var dataObj = {};

  strm.writable = strm.readable = true;

  toFuse.forEach(function (e) {
    e.pipe(strm, {end: false});
    var ended = false;

    e.on('end', function () {
      if(ended) return;
      ended = true;
      endCount++;

      if(endCount == toFuse.length) {
        strm.emit('data', dataObj);
        strm.emit('end');
      }
    })
  })

  strm.write = function (data) {
    dataObj = merge(data,dataObj);
  }
  strm.destroy = function () {
    toFuse.forEach(function (e) {
      if(e.destroy) e.destroy()
    })
  }
  return strm;
}

function pendingForUser(username){
  var thepath = path.join('app', 'users', username, 'pending', '*.json');
  console.log('looking in : ' + thepath)
  return vinylFs.src( thepath )
  .pipe(map(getContents))
  .pipe( es.map(function (data, cb) {
    cb(null, JSON.parse(data))
  }));
}

function pendingForAddress(address){
  var thepath = path.join('app', 'pending', address, '*.json');
  console.log('looking in : ' + thepath)
  return vinylFs.src( thepath )
  .pipe(map(getContents))
  .pipe( es.map(function (data, cb) {
    cb(null, JSON.parse(data))
  }));
}

function resolveTXHandlersList(r, resolve, resolver) {
  if(resolve){
    return Promise.map(r, function(handlers) { return handlers[resolver]; });
  } 
  else {
    return Promise.map(r, function(handlers) { return handlers.txHash; });
  }
}

function txToJSON(t) {
  var result = {
    "nonce"      : t.nonce,
    "gasPrice"   : t.gasPrice,
    "gasLimit"   : t.gasLimit,
    "to"         : t.to ? t.to.toString(): "",
    "value"      : t.value,
    "codeOrData" : t.data ? t.data.toString("hex") : "",
    "from"       : t.from ? t.from.toString() : "",
    "r"          : t.r ? t.r.toString(16) : "",
    "s"          : t.s ? t.s.toString(16) : "",
    "v"          : t.v ? t.v.toString(16) : "",
    "hash"       : t.partialHash()
  }
  if (result.to == "") {
    delete result.to;
  }
  return result;
}

String.prototype.hexEncode8 = function(){
  var hex, i;
  var result = "";
  for (i=0; i<this.length; i++) {
    hex = this.charCodeAt(i).toString(16);
    result += ("0"+hex).slice(-2);
  }
  return result
}

String.prototype.hexDecode8 = function(){
  var j;
  var hexes = this.match(/.{1,2}/g) || [];
  var back = "";
  for(j = 0; j<hexes.length; j++) {
    back += String.fromCharCode(parseInt(hexes[j], 16));
  }
  return back;
}

module.exports = {
  contractNameStream : contractNameStream,
  contractsStream : contractsStream,
  contractsMetaStream : contractsMetaStream,
  contractDirsStream : contractDirsStream,
  contractAddressesStream : contractAddressesStream,
  contractsMetaAddressStream : contractsMetaAddressStream,
  configStream : configStream,
  collect : collect,
  fuseStream : fuseStream,
  userNameStream : userNameStream,
  userKeysStream : userKeysStream,
  userKeysAddressStream : userKeysAddressStream,
  allKeysStream : allKeysStream,
  pendingForUser: pendingForUser,
  pendingForAddress: pendingForAddress,
  txToJSON: txToJSON,
  resolveTXHandlersList: resolveTXHandlersList,
  fromSolidity: function(x){
    if(x)
      return x.split('0').join('').hexDecode8();
    else
      return undefined;
  },
  toSolidity: function(x){
    if(x)
      return ("0".repeat(64)+x.hexEncode8()).slice(-64);
    else
      return undefined;
  }
};
