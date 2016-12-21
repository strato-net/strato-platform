const common = require('../lib/common');
const config = common.config;
const api = common.api;
const assert = common.assert;
const util = common.util;
const itShould = common.itShould;
const User = common.model.User
const Tx = common.model.Tx;
var vinylFs = require( 'vinyl-fs' );
var map = require( 'map-stream' );
var stream = require('stream');
var es = require('event-stream');
var fs = require('fs');
var lw = require('eth-lightwallet');
var blocApi = require('blockapps-js');
var Transaction = blocApi.ethbase.Transaction;
var Int = blocApi.ethbase.Int;
var Account = blocApi.ethbase.Account;
var request = require('request');
const path = require('path');
var Promise = require('bluebird');


var getContents = function(file, cb) {
  cb(null,file.contents);
};

function userKeysStream(user) {
  return vinylFs.src( [ path.join(config.blocUserFolder, user.name, user.address) + '.json'] )
      .pipe( map(getContents) )
      .pipe( es.map(function (data, cb) {
        cb(null, JSON.parse(data))
      }));
}

function generateSendTransactions(from, to, n) {
	return new Promise(function(resolve, reject){
		userKeysStream(from).pipe(es.map(function (data,cb) {
	        if (data.addresses[0] == from.address) cb(null,data);
	        else cb();
	      }))
			.on('data', function(data){
				// Get private keys
				var store = new lw.keystore.deserialize(JSON.stringify(data));
	          	var privkeyFrom = store.exportPrivateKey(from.address, config.password);

	          	var transactions = [];

	          	//get nonce and generate transactions
	          	Account(from.address).nonce
	          		.then(function(nonce){

	          		for(var i = 0; i < n ; i++) {
	          			var tx = Transaction({"value" : 100,
	                                 "gasLimit" : Int(21000),
	                                 "gasPrice" : Int(50000000000)});
			          	tx.from = from.address;
			          	tx.to = to.address;

	          			tx.nonce = nonce.plus(i);
		          		tx.sign(privkeyFrom);
		          		transactions.push(tx);
	          		}
	          		resolve(transactions);
	          	});
	        })
	        .on('end', function() {

			});
	});
};

function sendTransactions(transactions) {
	return new Promise(function(resolve, reject){
		try {
			var options = {
				uri: config.nodes[0].stratoUrl + '/eth/v1.2/transactionList',
				method: 'POST',
				json: transactions
			};
			request(options, function(err, response, body){
				if(err) {
					reject(err);
				}
				resolve(response);
			})
		}
		catch(e) {
			reject(e);
		}
	});
};

describe('TPS Batching ', function() {
	this.timeout(config.timeout);

	const alice = new User(util.uid('Alice'));
	itShould.createUser(alice);

	const bob = new User(util.uid('Bob'));
	itShould.createUser(bob);


	it('Alice\'s key file should exist', function(done){
		try {
			assert.isOk(fs.statSync( path.join(config.blocUserFolder, alice.name, alice.address) + '.json' ).isFile(), 'Alice\'s key file exists');
			done();
		}
		catch(e) {
			done(e);
		}
	});

	it('Bob\'s key file should exist', function(done){
		try {
			assert.isOk(fs.statSync( path.join(config.blocUserFolder, bob.name, bob.address) + '.json' ).isFile(), 'Bob\'s key file exists');
			done();
		}
		catch(e) {
			done(e);
		}
	});

	//simple send and confirm
	it('Should generate send transactions and confirm them', function(done){
		generateSendTransactions(alice, bob, 10)
			.then(function(transactions) {
				sendTransactions(transactions)
				.then(function(response){
					try {
						assert.equal(response.statusCode, 200, "Server accepted request");
					}
					catch(e) {
						done(e);
					}
					for(var i=0;i<response.body.length;i++) {
						verifyTx(response.body[i], true);
					}
					done();
				}, function(e) {
					done(e);
				});
			});
	});

	//post a large number.
	it('Should confirm one and fail the second one', function(done){
		generateSendTransactions(alice, bob, 2)
			.then(function(transactions) {
				sendTransactions(transactions)
				.then(function(response){
					try {
						assert.equal(response.statusCode, 200, "Server accepted request");
					}
					catch(e) {
						done(e);
					}
					for(var i=0;i<response.body.length;i++) {
						verifyTx(response.body[i], true);
					}
					done();
				}, function(e) {
					done(e);
				});
			});
	});

	//send from a to b. send from b to a.
	//send invalid from a to b (store nonce). send from b to a.
	//send valid from a to b. store this id

	//send valid with the nonce. check it the other one got confirmed.

	//repeat above but this time send another valid tx as the pending one.

});

function verifyTx(txHash,shouldSucceed) {
	describe('Verify results for transaction ' + txHash, function() {
		this.timeout(config.timeout);
		it('Transaction ' + txHash + ' should ' + (shouldSucceed ? '' : 'not ') + 'succeed', function(done){
			var vOptions = {
				uri: config.nodes[0].stratoUrl + '/eth/v1.2/transactionResult/' + txHash,
				method: 'GET'
			}
			request(vOptions, function(e,r,b){
				if(e) {
					done(e);
				}
				try{
					var result = JSON.parse(b);

					if(result.length == 0) {
						//no result. poll again
						verifyTx(txHash, shouldSucceed);
					}
					else {
						if(shouldSucceed) {
							assert.equal(result[0].message,'Success!',
								'Transaction ' + txHash + ' succeeded');
							done();
						}
						else {
							assert.notEqual(result[0].message,'Success!',
								'Transaction ' + txHash + ' failed');
							done();
						}
					}
				}
				catch(err){
					done(err);
				}
			});
		});
	});
};
