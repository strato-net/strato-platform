// import * as path from "path";

// import {
//   OAuthUser,
//   BlockChainUser,
//   Options,
//   Config,
//   Contract,
//   rest,
//   util,
//   fsUtil,
//   oauthUtil,
//   assert,
//   constants,
//   AccessToken
//   } from 'blockapps-rest';

// import BigNumber from "bignumber.js";
// import * as chai from "chai";
// chai.should();
// chai.use(require('chai-bignumber')());

// let config:Config=fsUtil.getYaml("config.yaml");
// let options:Options={config}

// let oauth:oauthUtil;
// let ouser1:OAuthUser;
// let ouser2:OAuthUser;

// const label = 'My chain label';
// const src = 'contract Governance { uint TEN = 10; constructor(){} } ';
// const args = {};
// const members = [{
//     orgName: "BlockApps"
//   }, {
//     orgName: "Microsoft"
//   }];
// const balances = [
//            { address: "00000000000000000000000000000000deadbeef"
//            , balance: 1000000000000000000000
//            },
//            { address: "0000000000000000000000000000000012345678"
//            , balance: 0
//            }];

// describe("Create Chain", function() {
//   this.timeout(config.timeout);
  
//   before(async () => {
//     oauth = await oauthUtil.init(config.nodes[0].oauth);
//     const accessToken1:AccessToken = await oauth.getAccessTokenByResourceOwnerCredential("user3", "1234", "strato-devel");
//     ouser1 = {token: accessToken1.token.access_token};
//     const accessToken2:AccessToken = await oauth.getAccessTokenByResourceOwnerCredential("user4", "1234", "strato-devel");
//     ouser2 = {token: accessToken2.token.access_token};
//   });

//   it('should create 100 new chains', async() => {
//     // create user
//     const alice = await rest.createUser(ouser1, options);
//     const bob = await rest.createUser(ouser2, options);
//     assert.isDefined(alice, "should exist");
//     assert.isDefined(alice.address, "should be defined");
//     assert.notEqual(alice.address, 0, "should be a nonzero address");
//     assert.isDefined(bob, "should exist");
//     assert.isDefined(bob.address, "should be defined");
//     assert.notEqual(bob.address, 0, "should be a nonzero address");

//     const bals = [{ address: alice.address, balance: 1000000000000000000000}
//                  ,{ address: bob.address, balance: 0}
//                  ];
//     const mems = members;
//     for(var i = 0; i < 100; i++) {
//     const chainId = await rest.createChain(ouser1, {label, members: mems, balances: bals, src, args}, {name: "Governance"}, options);
//     console.log('###CHAINID###',chainId);
//     assert.isDefined(chainId, "should exist");
//     assert.notEqual(chainId, '', "should be a nonzero address");
//     }

//   });

//   it('should create a new chain and query the chain details', async() => {
//     // create user
//     const alice = await rest.createUser(ouser1, options);
//     const bob   = await rest.createUser(ouser2, options);
//     assert.isDefined(alice, "should exist");
//     assert.isDefined(alice.address, "should be defined");
//     assert.notEqual(alice.address, 0, "should be a nonzero address");
//     assert.isDefined(bob, "should exist");
//     assert.isDefined(bob.address, "should be defined");
//     assert.notEqual(bob.address, 0, "should be a nonzero address");

//     const bals = [{ address: alice.address, balance: 1000000000000000000000}
//                  ,{ address: bob.address, balance: 0}
//                  ];
//     const mems = members;
//     const chainId = await rest.createChain(alice, {label, members: mems, balances: bals, src, args}, {name: "Governance"}, options);
//     console.log('###CHAINID###',chainId);
//     assert.isDefined(chainId, "should exist");
//     assert.notEqual(chainId, '', "should be a nonzero address");

//     await promiseTimeout(1000);

//     const chainInfo = await rest.getChain(alice, chainId, options);
//     console.log('###CHAININFO###',chainInfo);
//     assert.isDefined(chainInfo, "should exist");
//     assert.deepEqual(label, chainInfo.info.label, "chain labels should be identical");

//     const chainAddress = '0000000000000000000000000000000000000100';

//     // Despite not running the constructor, bloch will at least
//     // return the constants and functions.
//     const state = await rest.getState(alice, {name: 'Governance', address: chainAddress, chainId}, {...options, chainIds: chainId});
//     assert.hasAnyKeys(state, ['TEN']);

//     for(var i=0; i < 10; i++) {
//       const txResult = await rest.send(alice, {toAddress: bob.address, value: 123456, chainId}, options);
//       console.log('### TRANSACTION RESULT ###', txResult);
//     }

//   });

//   it('should not create a new chain when members list is empty', async() => {
//     // create user
//     const alice = await rest.createUser(ouser1, options);
//     const bob   = await rest.createUser(ouser2, options);
//     const bals = [{ address: alice.address, balance: 1000000000000000000000}
//                   ,{ address: bob.address, balance: 0}
//                  ];
//     assert.isDefined(alice, "should exist");
//     assert.isDefined(alice.address, "should be defined");
//     assert.notEqual(alice.address, 0, "should be a nonzero address");
//     assert.isDefined(bob, "should exist");
//     assert.isDefined(bob.address, "should be defined");
//     assert.notEqual(bob.address, 0, "should be a nonzero address");

//     let chainId;
//     try {
//       chainId = await rest.createChain(alice, {label, members: [], balances: bals, src, args}, {name: "Governance"}, options);
//     } catch(e) {
//       assert.equal(e.response.status,400, `fails with ${e.statusText}`);
//     }
//     assert.isUndefined(chainId, "chainId not defined");
//   });

//   it('should not create a new chain when balances are empty', async() => {
//     // create user
//     const alice = await rest.createUser(ouser1, options);
//     const bob   = await rest.createUser(ouser2, options);
//     const mems = members;
//     assert.isDefined(alice, "should exist");
//     assert.isDefined(alice.address, "should be defined");
//     assert.notEqual(alice.address, 0, "should be a nonzero address");
//     assert.isDefined(bob, "should exist");
//     assert.isDefined(bob.address, "should be defined");
//     assert.notEqual(bob.address, 0, "should be a nonzero address");

//     let chainId;
//     try {
//       chainId = await rest.createChain(alice, {label, members: mems, src, balances: [], args: {}}, {name: "Governance"}, options);
//     } catch(e) {
//       assert.equal(e.response.status,400, `fails with ${e.statusText}`);
//     }
//     assert.isUndefined(chainId, "chainId not defined");
//   });

//   // TODO: unsure if we want to support this functionality; either delete or come to a consensus
//   xit('should create a new chain when contract source is empty', async() => {
//     // create user
//     const alice = await rest.createUser(ouser1, options);
//     const bob   = await rest.createUser(ouser2, options);
//     const bals = [{ address: alice.address, balance: 1000000000000000000000}
//                   ,{ address: bob.address, balance: 0}
//                  ];
//     const mems = members;
//     assert.isDefined(alice, "should exist");
//     assert.isDefined(alice.address, "should be defined");
//     assert.notEqual(alice.address, 0, "should be a nonzero address");
//     assert.isDefined(bob, "should exist");
//     assert.isDefined(bob.address, "should be defined");
//     assert.notEqual(bob.address, 0, "should be a nonzero address");

//     const chainId = await rest.createChain(alice, {label, members: mems, balances: bals, src: "", args}, <Contract>{}, options);
//     assert.isDefined(chainId, "should exist");

//     await promiseTimeout(1000);

//     const chainInfo = await rest.getChain(ouser1, chainId, options);
//     console.log('###CHAININFO###',chainInfo);
//     assert.isDefined(chainInfo, "should exist");
//   });

//   it('should not create a new chain when all accounts have 0 balance', async() => {
//     // create user
//     const alice = await rest.createUser(ouser1, options);
//     const bob   = await rest.createUser(ouser2, options);
//     assert.isDefined(alice, "should exist");
//     assert.isDefined(alice.address, "should be defined");
//     assert.notEqual(alice.address, 0, "should be a nonzero address");
//     assert.isDefined(bob, "should exist");
//     assert.isDefined(bob.address, "should be defined");
//     assert.notEqual(bob.address, 0, "should be a nonzero address");

//     const mems = members;
//     const bals = [{ address: alice.address, balance: 0}
//                  ,{ address: bob.address, balance: 0}
//                  ];
//     let chainId;
//     try {
//       chainId = await rest.createChain(alice, {label, members: mems, balances: bals, src, args}, {name: "Governance"}, options);
//     } catch(e) {
//       assert.equal(e.response.status,400, `fails with ${e.statusText}`);
//     }
//     assert.isUndefined(chainId, "chainId not defined");
//   });

//   /*
//   FIXME: Disabling the test because it fails with the timeout if there is at least one user cert precreated on the blockchain, and the private chains are now to be deprecated. Still worth checking if something else may be broken with the cert pre-existing...
//   1) Create Chain should be able to create a private chain with a CodePtr to existing code:
//      Error: until: timeout 60000 ms exceeded
//       at Object.call (/lib/util/util.js:242:31)
//       at step (/lib/util/util.js:33:23)
//       at Object.next (/lib/util/util.js:14:53)
//       at g (/lib/util/util.js:5:58)
//    */
//   xit('should be able to create a private chain with a CodePtr to existing code', async() => {
//     // create users
//     const alice = await rest.createUser(ouser1, options);
//     const bob   = await rest.createUser(ouser2, options);
//     assert.isDefined(alice, "should exit");
//     assert.isDefined(alice.address, "should be defined");
//     assert.notEqual(alice.address, 0, "should be a nonzero address");
//     assert.isDefined(bob, "should exit");
//     assert.isDefined(bob.address, "should be defined");
//     assert.notEqual(bob.address, 0, "should be a nonzero address");


//     const ccSrc = "contract Main { uint x; constructor() { x = 0; } } contract Governance { uint y; constructor() { y = 1; } }";


//     // this is a SolidVM feature
//     let vmOptions = {config};
//     vmOptions.config.VM = 'SolidVM'; 
    
//     // upload main (and thus, the whole code collection)
//     const main = <Contract> await rest.createContract(alice, {name: "Main", source: ccSrc, args: {}}, vmOptions);
    
//     assert.isDefined(main, "should exist");
//     assert.isDefined(main.address, "should be defined");
//     assert.notEqual(main.address, 0, "should be a nonzero address");

//     // create chain with codePtr
//     const mems = members;
//     const bals = [{ address: alice.address, balance: 1000000}
//                  ,{ address: bob.address, balance: 10000000}
//                  ];
    
//     const codePtr = { account: main.address, name: "Governance" }; 

//     const chainId = await rest.createChain(alice, {label, members: mems, balances: bals, codePtr, args}, {name: "Governance"}, vmOptions);

//     assert.isDefined(chainId, "chainId defined");
//     assert.notEqual(chainId, "", "chainId is not zero");

//     // query cirrus for the gov contract
//     const govList = await rest.searchUntil(alice, { name: "Governance" }, (r) => r.length > 0, { query: { chainId: `eq.${chainId}` }, ...options });
//     assert.equal(govList.length, 1, "one instance of Governance on this chain");
//     const gov = govList[0];
//     assert.isDefined(gov, "Governance contract apperas in Cirrus");
//     assert.equal(gov.y, '1', "Governance contract storage matches what we expect");
//   });

// });

// function promiseTimeout(timeout) {
//   return new Promise(function(resolve, reject) {
//     setTimeout(resolve, timeout);
//   });
// }
