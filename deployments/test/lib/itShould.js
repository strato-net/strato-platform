const BigNumber = require('bignumber.js');
const util = require('./util');
const importer = require('./importer');
const Promise = require('q');

// readFIle wrapped in a promise
function readFile(filename) {
  return Promise.denodeify(fs.readFile);
}

function api_bloc_contract(api, config, user, contract, done) {
  return api.bloc.contract({
      password: config.password,
      src: contract.string,
      args: contract.args,
      contract: contract.name,
      txParams: contract.txParams
    }, user.name, user.address)
    .then(function(address) {
      if (util.isAddress(address)) {
        contract.address = address;
        done();
      } else {
        done(new Error('contract upload should produce a valid address ' + address));
      }
    })
    .catch(function(err) {
      if (err.data !== undefined) {
        done(new Error(err.data));
      } else {
        done(err);
      }
    });
}

function api_bloc_import(api, config, user, contract, done){
  return api.bloc.import({
      password: config.password,
      src: JSON.parse(contract.string),
      contract: contract.solName,
      name: contract.name
    }, user.name, user.address)
    .then(function(address) {
      // console.log("contract address is: " + address)
      if (util.isAddress(address)) {
        contract.address = address;
        done();
      } else {
        done(new Error('contract import should produce a valid address ' + JSON.stringify(address)));
      }
    })
    .catch(function(err) {
      console.log("error: ", JSON.stringify(err));
      if (err.data !== undefined) {
        done(new Error(err.data));
      } else {
        done(err);
      }
    });
}

module.exports = function(api, config) {
  return {
    // create user
    createUser: function(user, node) {
      return it('should create user ' + user.name, function(done) {
        api.setNode(node);
        return api.bloc.createUser({
            faucet: '1',
            password: config.password,
          }, user.name)
          .then(function(address) {
            if (util.isAddress(address)) {
              user.address = address;
              done();
            } else {
              done(new Error('create user should produce a valid address ' + JSON.stringify(address)));
            }
          }).catch(done);
      });
    },
    // get user's balance as BigNumber
    getBalance: function(user, node) {
      const nodeId = (node === undefined) ? '' : ' node:' + node;
      return it('should get balance for user ' + user.name + nodeId, function(done) {
        user.balance = undefined;
        api.setNode(node);
        return api.strato.account(user.address)
          .then(function(accounts) {
            user.balance = new BigNumber(accounts[0].balance);
            done();
          }).catch(done);
      });
    },
    // get account's code and fills into `code`
    getCode: function(user, node) {
      return it('should get code for the account ' + JSON.stringify(user), function(done) {
        user.code = undefined;
        api.setNode(node);
        return api.strato.account(user.address)
          .then(function(accounts) {
            user.code = accounts[0].code;
            done();
          }).catch(done);
      });
    },

    // read a file
    readFile: function(fileDescriptor) {
      return it('should read a file ' + fileDescriptor.filename, function(done) {
        return util.readFile(fileDescriptor.filename)
          .then(function(buffer) {
            fileDescriptor.buffer = buffer;
            fileDescriptor.string = buffer.toString();
            done();
          }).catch(done);
      });
    },

    // upload a contract
    uploadContract: function(user, contract, node) {
      return it('should upload a contract ' + contract.name, function(done) {
        api.setNode(node);
        return api_bloc_contract(api, config, user, contract, done);
      });
    },
    // import and upload a contract - merge all to a blob first
    importAndUploadBlob: function(user, contract, node) {
      return it('should import and upload a contract ' + contract.filename, function(done) {
        api.setNode(node);
        return importer.getBlob(contract.filename)
          .then(function(string){
            // save the contract src
            contract.string = string;
            return api_bloc_contract(api, config, user, contract, done);
          })
          .catch(done);
        });
    },
    // import a nested contract as JSON
    import: function(user, contract, node){
      return it('should import a contract JSON object ' + contract.filename, function(done) {
        api.setNode(node);
        return importer.readFile(contract.filename)
          .then(function(string){
            contract.string = string;
            return api_bloc_import(api, config, user, contract, done);
          })
          .catch(done);
      });
    },
    // get a contract's state
    getAbi: function(contract, node) {
      return it('should get the abi for ' + contract.name, function(done) {
        api.setNode(node);
        return api.bloc.abi(contract.name, contract.address)
          .then(function(state) {
            contract.state = state;
            done();
          })
          .catch(done);
      });
    },
    // get a contract's state
    getStorage: function(storage, node) {
      return it('should get storage for ' + storage.attr + ":" + storage.value, function(done) {
        api.setNode(node);
        return api.strato.storage(storage.attr, storage.value)
          .then(function(result) {
            //console.log(result);
            storage.result = result;
            done();
          })
          .catch(done);
      });
    },
    // get a contract's stateRoute
    getState: function(contract, node) {
      return it('should check the state of ' + contract.name, function(done) {
        api.setNode(node);
        return api.bloc.state(contract.name, contract.address)
          .then(function(state) {
            contract.state = state;
            done();
          })
          .catch(done);
      });
    },
    getStateMapping: function(contract, node) {
      return it('should lookup the state of ' + contract.name + " with mapping", function(done) {
        api.setNode(node);
        return api.bloc.stateLookup(contract.name, contract.address, contract.mapping, contract.key)
          .then(function(state) {
            contract.state = state;
            done();
          })
          .catch(done);
      });
    },
    // get a contract's list of all instances
    getContracts: function(contract, node) {
      return it('should get the list of ' + contract.name, function(done) {
        api.setNode(node);
        return api.bloc.contracts(contract.name)
          .then(function(array) {
            contract.addresses = array.filter(function(item){
              return util.isAddress(item);
            });
            done();
          })
          .catch(done);
      });
    },
    // get a contract's list of all instances
    getContractsByCode: function(contractString, contract, node) {
      return it('should get the list of contracts having code ' + contractString, function(done) {
        api.setNode(node);
        return api.strato.search(contractString)
          .then(function(array) {
            contract.addresses = array;
            done();
          })
          .catch(done);
      });
    },
    // get a contract's list of all instances
    getContractsByCodeHash: function(contractString, contract, node) {
      return it('should get the list of contracts having codeHash ' + contractString, function(done) {
        api.setNode(node);
        return api.strato.searchHash(contractString)
          .then(function(array) {
            contract.addresses = array;
            done();
          })
          .catch(done);
      });
    },
    getContractsBySearch: function(search, lookup, node){
      return it('should get states of contracts by name ' + search.name, function(done){
        api.setNode(node);
        return api.bloc.search(search.name, lookup)
          .then(function(array) {
            search.stateMap = array;
            // this doesn't work with our `node` version?
            // var keys = Object.values(array);
            // search.addresses = keys.filter(function(item){
            //   return util.isAddress(item);
            // });
            // var values = keys.map(function(i){return a[i]});
            // search.state = values;
            done();
          });
      })
    },

    // get the states for the all the contract's instances
    getContractsState: function(search, lookup, node) {
      return it('should get the states for all of contract ' + search.name, function(done) {
        api.setNode(node);
        return api.bloc.contracts(search.name)
          .then(function(array) {
            search.addresses = array.filter(function(item){
              return util.isAddress(item);
            });
            var promises = search.addresses.map(function(address) {
              return api.bloc.state(search.name, address, lookup).then(function(state){
                state.address = address;
                return state;
              });
            });
            return Promise.all(promises).then(function(states){
              search.states = states;
              done();
            });
          })
          .catch(done);
      });
    },
    // call a method
    callMethod: function(user, contract, call, node) {
      return it('should call a method ' + JSON.stringify(call), function(done) {
        api.setNode(node);
        return api.bloc.method({
            password: config.password,
            method: call.method,
            args: call.args,
            value: 0.1,
          }, user.name, user.address, contract.name, contract.address)
          .then(function(result) {
            call.result = result;
            done();
          })
          .catch(function(err) {
            if (err.data !== undefined) {
              done(new Error(err.data));
            } else {
              done(err);
            }
          });
      });
    },
    // send a transaction
    send: function(tx, node) {
      return it('should send ' + tx.toString(), function(done) {
        api.setNode(node);
        return api.bloc.send({
            password: config.password,
            toAddress: tx.toUser.address,
            value: tx.valueEther,
          }, tx.fromUser.name, tx.fromUser.address)
          .then(function(result) {
            tx.result = result;
            done();
          })
          .catch(function(err){done(new Error(err.data));});
      });
    },
    sendList: function(txs, node){
      console.log("sendList")
      return it('should send ' + txs.length + ' txs', function(done){
        done();
        api.setNode(node);
        return api.bloc.sendList({
          password: config.password,
          txs: txs
          })
        .then(function(result){
          // do I need to set something simlar to `tx.result = result` for this to resolve?
          done();
        })
        .catch(function(err){done(new Error(err.data));});
      })
    },
    search: function(search, node) {
      return it('should get the states for all of contract ' + search.name, function(done) {
        api.setNode(node);
        return api.bloc.search(search.name).then(function(result){
          search.states = result;
          done();
        });

      });
    },
    searchReduced: function(search, node) {
      return it('should get the reduced states for all of contract ' + search.name, function(done) {
        api.setNode(node);
        return api.bloc.searchReduced(search.name).then(function(result){
          search.states = result;
          done();
        });

      });
    },
    searchSummary: function(search, node) {
      return it('should get the well\'s sample\'s state enum' + search.name, function(done) {
        api.setNode(node);
        return api.bloc.searchSummary(search.name, search.well).then(function(result){
          search.states = result;
          done();
        });

      });
    },
    // faucet
    faucet: function(user, node) {
      return it('should send from the faucet to ' + user.name, function(done) {
        api.setNode(node);
        return api.strato.faucet({address: user.address})
          .then(function(result) {
            done();
          })
          .catch(function(err){done(new Error(err.data));});
      });
    },

    // check service availability
    checkAvailability: function() {
      return it('should check services availability', function(done) {
        util.retry(api.bloc.home, done);
      });
    },

    // compile list of contract sources
    compileContracts: function(contractSources) {
      return it('should compile a list of contract sources', function(done) {
        api.bloc.compile(contractSources.sources).then(function(result){
          //should return an array of contractNames and their hashes
          done();
          contractSources.results = result;
          return result;
        })
      })
    }
  };
};
