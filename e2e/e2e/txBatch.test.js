#!/usr/bin/env node

var Promise = require("bluebird");
var lib = require("blockapps-js");
var chalk = require('chalk')
var chai = require('chai')
var chap = require('chai-as-promised')
var mocha = require('mocha')
var rp = require('request-promise');
var _ = require('lodash/fp')

chai.use(chap)
chai.should()

lib.handlers.enable = true;
console.log("transaction resolver")

const flatten = (ary) => ary.reduce((a, b) => a.concat(Array.isArray(b) ? flatten(b) : b), [])

var argv = require('minimist')(process.argv.slice(2), 
  { default: 
    { size: 1
    , nconc: 1
    , toEnabled: 0 
    , gapMS: 3000
    , txOffset: 0
    , throwError: 0
    , standAlone: 0
    , strato: "http://localhost/strato-api"
    }
  }
);

var size = argv.size;
var gapMS = argv.gapMS;
var nconc = argv.nconc;
var toEnabled = argv.toEnabled;
var txOffset = argv.txOffset;
var throwError = argv.throwError;

lib.setProfile("ethereum-frontier", argv.strato);

var privkey = lib.ethbase.Crypto.PrivateKey.random();
var address = privkey.toAddress();
var account = lib.ethbase.Account(privkey.toAddress());

console.log("Address is: " + address);

var insp = function(x) {
   Promise.resolve(x[0]).then(y => console.log("x[0]: " + JSON.stringify(y.txResult)))
   Promise.resolve(x[1]).then(y => console.log("x[1]: " + JSON.stringify(y.txResult)))                                    
}

var mkTxs = function(privkey, n, nonces, toAddress, value){
  var txs = [];
  nonces.map((i,j) => {
    var address = toAddress == 1 ? privkey.toAddress() : undefined; 
    var v       = value == 1     ? (""+j) : "0"
    nn = n + i
    txs.push(lib.ethbase.Transaction({nonce: nn, to: address, value: v}))
    //console.log("to: " + address + "; nonce: " + nn + "; value: " + v) 
  })
  return txs.map(t => t.sign(privkey))
}

var mkTest = function(msg, privkey, nonces, toAddress, value, nres){
  it(msg + ':: should transmit ' + nonces + ' txs for address ' + privkey.toAddress() + ' resulting in ' + JSON.stringify(nres), function() {
      this.timeout(2000*nonces.length);  
      return Promise.all(lib.ethbase.Account(privkey.toAddress()).nonce.then(n => {
        //console.log("nonce for " + privkey.toAddress() + " is " + n);
        return lib.routes.submitTransactionList(mkTxs(privkey, n, nonces, toAddress, value));
      })
      .tap(r => {
      //  console.log(JSON.stringify(r))
      })
      .catch(e => {
        console.log("Error: " + e)
        throw e;
      })
      .then(txs => {
        return (txs.map(t => {
          return t.txHash
            .delay(1000 + 100*nonces.length)
            .then(hash => {
              return rp({uri: argv.strato + '/eth/v1.2/transactionResult/' + hash, json: true})
                .then(json => {
                  var message = "Unresolved!";
                  if(json.length > 0){
                    message = json[0].message;
                    if(message.indexOf("Rejected") == 0)
                      message = "Rejected!"
                   // console.log("transactionResult for " + hash + " is: " + message)
                  }
                  return {tx: hash, message: message};
                })
              })
            }))
      }))
      .then(_.countBy('message'))
      .should.eventually.deep.equal(nres);
     
  })
}

var mkFaucet = function(privkey){
 it('should call faucet for ' + privkey.toAddress(), function(){
   return lib.routes.faucet(privkey.toAddress()).should.be.fulfilled;
 })
}

if(argv.standAlone==0){
  describe('different transaction rejection tests', __ => {
       
       // throwError=1 : should throw, occasionally
  //   for(var i = 0; i < 50; i++){
  //     it("shouldn't hit address bug " + i, function(done) {
  //       var p = lib.ethbase.Crypto.PrivateKey.random();
  //       return lib.routes.faucet(p.toAddress()).then(r => {
  //         var retAddress = r.address;
  //         console.log("address: " + retAddress)
  //         done();
  //         return new Promise(p.toAddress().toString() == retAddress);
  //       }).should.equal.true;
  //     })
  //   }
  
  // failure modes: 
  // toEnabled=1, txOffset=1 : we don't get response because TX not put in TX result
  // toEnabled=1, txOffset=1, nconc=2, size=2 : we should get one rejected (out of four)
 
    var p1 = lib.ethbase.Crypto.PrivateKey.random();
    mkFaucet(p1)
    mkTest("should do all transactions" , p1, [0,1,2,3,4,5,6], 1, 1, {"Success!":7})
    
    var p2 = lib.ethbase.Crypto.PrivateKey.random();
    mkFaucet(p2)
    mkTest("should reject latter txs with nonces too low - this triggers (#138009465)", p2, [0,1,2,3,4,5,6,7,8,9,9,9,9,9], 1, 1,{"Success!": 10, "Rejected!": 4}) 
   
    var p3 = lib.ethbase.Crypto.PrivateKey.random();
    mkFaucet(p3)
    mkTest("should timeout on transactions with nonce in the future and missing .to (#137405949)", p3, [1,2,3,4], 0, 1, {"Unresolved!": 4})

    var p4 = lib.ethbase.Crypto.PrivateKey.random();
    mkFaucet(p4)
    mkTest("should timeout on transactions with nonce in the future" , p4, [1,2,3,4], 1, 1, {"Unresolved!": 4})

    var p5 = lib.ethbase.Crypto.PrivateKey.random();
    mkFaucet(p5)
    mkTest("should not timeout on some transactions with nonce in the future" , p5, [0,1,2,1,4], 1, 1, {"Success!": 3, "Rejected!": 1, "Unresolved!":1})

    var p6 = lib.ethbase.Crypto.PrivateKey.random();
    mkFaucet(p6)
    mkTest("should not timeout on transactions with duplicate nonce" , p6, [0,1,1,2,2], 1, 1, {"Success!": 3, "Rejected!": 2})
    mkTest("transactions should work, if called after rejections" , p6, [0,1,2], 1, 1, {"Success!": 3})



  })
} else {

var faucet = lib.routes.faucet(lib.ethbase.Address(address))
  .then(ret => {
    console.log("Faucet called for " + ret.address); 
    if(ret.address !== address.toString())
      if(throwError==1)
        throw Error("hit the address serialization bug")
      else
        console.log("hit the address serialization bug")
    return ret.address;
  })
  .then(a =>{
     account.balance.then(b => {
       console.log("balance is: " + b.toString());
     }).then(aa => {

       account.nonce.then(n => {
         console.log("current nonce: " + n);

         var toSend = [];
         for(var i = 0; i < nconc; i++){
           toSend.push(sendBatch(n, i, toEnabled, txOffset, size))
         }
    
         return Promise.all(toSend);
       })
       .then(r => {
         //console.log(r[0].address);
         var x = JSON.stringify(r)
         console.log("Done..")
       })
       .then(console.log("Done!"))
     })
  });
}
var currentNonce = 0;
var startTime;
var batchesDispatched = 0;

var sendBatch = function(nonce, concNum, toEnabled, txOffset, size){

  var c = (concNum == 0) ? chalk.green : (a => chalk.blue('\t\t\t\t\t\t\t'+a));

  process.stdout.write(c("# Sending " + size + " transactions\n"));

  var txList = [];
  for (i = 0; i < size; ++i) {
    var tx = lib.ethbase.Transaction({nonce: nonce + i + txOffset});
    tx.value = "0";
    if(toEnabled==1)
      tx.to   = lib.ethbase.Crypto.PrivateKey.random().toAddress();
    if(toEnabled==2)
      tx.to   = address;
    console.log("tx.to is: " + tx.to)
    console.log("that's " + tx.to.length + " bytes")
    console.log("that's " + tx.to.toString().length + " chars")
    tx.sign(privkey);
    txList.push(tx);
    //tx.send(privkey).then(r => {
    //  console.log("Result: " + JSON.stringify(r))
    //})
    process.stdout.write(c("tx: " + JSON.stringify(tx) + "\n\n"));
  }

  //return lib.ethbase.Transaction.sendList(txList, privkey)
  return lib.routes.submitTransactionList(txList);
}

