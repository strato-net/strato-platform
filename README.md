# bloc

[![BlockApps logo](http://blockapps.net/img/logo_cropped.png)](http://blockapps.net)

[![Join the chat at https://gitter.im/blockapps/bloc](https://badges.gitter.im/Join%20Chat.svg)](https://gitter.im/blockapps/bloc?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge) [![Build Status](https://travis-ci.org/blockapps/bloc.svg)](https://travis-ci.org/blockapps/bloc) [![npm version](https://badge.fury.io/js/blockapps-bloc.svg)](https://badge.fury.io/js/blockapps-bloc)

`bloc` makes building applications for the Ethereum blockchain as easy. Bloc uses the [blockapps api](https://blockapps.net) and provides: 
* Application scaffolding and generated UI based on smart contracts methods to test interactions
* Generated Smart Contract APIs to make working with Ethereum smart contracts easy in any language
* Ethereum Account key management

##Installation

The easiest way to get started is to install `bloc` from NPM:

```sh
npm install -g blockapps-bloc
```

You can also check out the github repo and build it by running
```sh
git clone https://github.com/blockapps/bloc
cd bloc; npm install -g
```

##Generate a new blockchain app

You can use `bloc init` to create a sample app.

```
bloc init
```

`bloc` init builds a base structure for your blockchain app as well as sets some default parameters values for creating transactions. These can be edited in the `config.yaml` file in your app directory.

The `config.yaml` file also holds the app's `apiURL`.  This can be configured to point to an isolated test network, or the real Ethereum network.  You can change this link, which will allow you to build and test in a sandboxed environment, and later re-deploy on the real Ethereum blockchain.

You will find the following files in your newly created app directory:

```
/app
  /components
  /contracts
  /lib
  /meta
  /routes
  /static
  /users
app.js
bower.json
config.yaml
gulpfile.js
marko-taglib.json
node_modules
package.json
```

- The "contracts" directory holds Ethereum blockchain code, written in the Solidity language, which you can learn about here- https://solidity.readthedocs.org/en/latest/.  This is the code that will run on the blockchain.  Samples contracts have been provided to get you started.

- Key management to handle account keys for users and signing transactions with bloc. 

- Once contracts are deployed `bloc` provides a RESTful interface for interacting with deployed contracts. Simply call contract methods with an address and pass the password to decrypt your key.

##Creating a Sample Account

After initing your app, run the following to download the dependencies for the app:

```
npm install
```

Once this is finished run

```
bloc genkey
```

This generates a new user with name `admin` as well as a private key and fills it with test-ether (note- free sample Ether is only available on the test network, of course). You can view the address information in the newly created `app/users/admin/<address>.json` file. Also, beware that this file contains your private key, so if you intend to use this address on the live network, make sure you keep this file secure and hidden.

The new account has also been created on the blockchain, and you can view account information by using our REST API directly in a browser by visiting http://strato-dev4.blockapps.net/eth/v1.2/account?address= &lt; fill in your address here &gt;

An example output is: 

```sh
curl "http://strato-dev4.blockapps.net/eth/v1.2/account?address=6ad318ce7b79c37b262fbda8a603365bbdbd41be"
```
```json
[
  {
    "contractRoot":"b6cb85d496db315a96b5820d9166206267db7ca57116bb6f9cc094ee9437986b",
    "kind":"AddressStateRef",
    "balance":"100000000000000000000",
    "address":"6ad318ce7b79c37b262fbda8a603365bbdbd41be",
    "latestBlockNum":3451,
    "code":"",
    "nonce":0
  }
]
```

##Uploading Contracts

Getting a contract live on the blockchain is a two step process

1. Compile the contract
2. Upload the contract

To compile a smartcontract, run

```
bloc compile <ContractName>
```

If there are any bugs in your contract code, this is where you will be allowed to fix them.

Upload a contract using

```
bloc upload <ContractName>
```

You will now see that Ether has been deducted from your account

```sh
curl "http://strato-dev4.blockapps.net/eth/v1.2/account?address=6ad318ce7b79c37b262fbda8a603365bbdbd41be"
```
```json
[
  {
    "contractRoot":"b6cb85d496db315a96b5820d9166206267db7ca57116bb6f9cc094ee9437986b",
    "kind":"AddressStateRef",
    "balance":"999999999999999994325",
    "address":"6ad318ce7b79c37b262fbda8a603365bbdbd41be",
    "latestBlockNum":3452,
    "code":"",
    "nonce":0
  }
]
```

Also, the newly created contract has been given its own address, which you can view in the data in the `app/users/<username>` folder.  Viewing contract information, including compiled bytecode for your Solidity contract can be done using the same URL that you use to view your own account information.

```sh
curl "http://strato-dev4.blockapps.net/eth/v1.2/account?address=47424dbce71e182d2836045b76a7e1ce459d6e08"
```

```json
[
   {
      "contractRoot" : "56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
      "address" : "47424dbce71e182d2836045b76a7e1ce459d6e08",
      "latestBlockNum" : 3452,
      "balance" : "0",
      "nonce" : 0,
      "kind" : "AddressStateRef",
      "code" : "60606040526000357c01000000000000000000000000000000000000000000000000000000009004806358793050146100445780638df554b31461005357610042565b005b6100516004805050610062565b005b61006060048050506101f1565b005b61aabb600060006101000a81548173ffffffffffffffffffffffffffffffffffffffff0219169083021790555061ccdd600160006101000a81548173ffffffffffffffffffffffffffffffffffffffff0219169083021790555061eeff600260006101000a81548173ffffffffffffffffffffffffffffffffffffffff02191690830217905550602360036000506000600060009054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060005081905550602360036000506000600160009054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffff"
   }
]
```

## Running The Local Webserver

Bloc ships with a node server. To get the server up and running

```
bloc start
```

Now you can visit one of the contracts in your application, for example http://localhost:3000/contracts/Payout. Note
that the local webserver relies on dynamically generated templates, founds in the `app/components` directory.

`bloc` will run through three contract status checks

  1. Does the contract exist in the project
  2. Has the contract been compiled
  3. Has the contract been uploaded to the network

This will be reflected in the application as well as at the terminal

##Keyserver & Contract API

Once you have a deployed contract `bloc` will provide a simple REST API for interacting with the contract. The API has routes for viewing contract methods, symbols, calling contract methods. The keyserver and contract API documentation can be viewed [here](http://blockapps.net/documentation#keyserver-api-endpoints) 

## Commands

```
Usage: /usr/local/bin/bloc <command> (options)

Commands:
  init [appName]      start a new project
  compile [contract]  compile contract in contract folder
  upload contract     upload contract to blockchain
  genkey [user]       generate a new private key and fill it at the faucet,
                      namespaced by user
  send                start prompt, transfer (amount*unit) to (address)
  start               start bloc as a webserver with live reload

Options:
  -u                  [default: "admin"]
```

## Additional Resources
`bloc` uses [blockapps-js](https://github.com/blockapps/blockapps-js), our  library for interfacing with the blockchain in a simple way.
Smart contracts that are written in javascript-like language called [Solidity](https://github.com/ethereum/wiki/wiki/The-Solidity-Programming-Language). A good place to start playing around with Solidity is the [online compiler](https://chriseth.github.io/browser-solidity/).
