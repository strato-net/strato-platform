import {
   GraphQLObjectType
  ,GraphQLString
  ,GraphQLInt
  ,GraphQLSchema
  ,GraphQLList
  //,GraphQLNonNull
} from 'graphql';

import Db from './db';

// @flow


//
// modified from
// http://stackoverflow.com/a/21648161/509642
// 

String.prototype.hexEncode16 = function(){
    var hex, i;
    var result = "";
    for (i=0; i<this.length; i++) {
        hex = this.charCodeAt(i).toString(16);
        result += ("000"+hex).slice(-4);
    }
    return result
}

String.prototype.hexDecode16 = function(){
    var j;
    var hexes = this.match(/.{1,4}/g) || [];
    var back = "";
    for(j = 0; j<hexes.length; j++) {
        back += String.fromCharCode(parseInt(hexes[j], 16));
    }
    return back;
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

//
// from
// http://stackoverflow.com/a/14810714/509642
// 

Object.defineProperty(Object.prototype, 'map', {
    value: function(f, ctx) {
        ctx = ctx || this;
        var self = this, result = {};
        Object.keys(self).forEach(function(k) {
            result[k] = f.call(ctx, self[k], k, self); 
        });
        return result;
    }
});

var fromSolidity = function(x){
  if(x)
    return x.split('0').join('').hexDecode8();
  else
    return undefined;
}

var toSolidity = function(x){
  if(x)
    return ("0".repeat(64)+x.hexEncode8()).slice(-64);
  else
    return undefined;
}

const Storage = new GraphQLObjectType({
  name: 'Storage',
  description: 'Storage of a contract',
  fields(){
    return {
      keyString:{
        type: GraphQLString,
        resolve(storage){
          return fromSolidity(storage.key);
        }
      },
      key:{
        type: GraphQLString,
        resolve(storage){
          return storage.key;
        }
      },
      valueString:{
        type: GraphQLString,
        resolve(storage){
          //return storage.value.split('00').slice(-1)[0].hexDecode8();
          return fromSolidity(storage.value);
          //­­­return storage.value.hexDecode8().toString();
        }
      },
      value:{
        type: GraphQLString,
        resolve(storage){
          return storage.value;
        }
      },
      contract:{
        type: AddressStateRef,
        args: {
          id: {
            type: GraphQLInt,
          }
        },
        resolve(storage){
          //return Db.models.address_state_ref.findById(storage.address_state_ref_id, {attributes: ["id", "address", "nonce", "balance", "contract_root", "code", "latest_block_data_ref_number"]});
          // findById doesn't work as long as `address` is set to primaryKey
          return Db.models.address_state_ref.findOne({where: {'id':storage.address_state_ref_id}});
        }
      }
    }
  }
});

const BlockDataRef = new GraphQLObjectType({
  name: 'BlockDataRef',
  description: 'A mined block',
  fields(){
    return {
      hash:{
        type: GraphQLString,
        resolve(block) : GraphQLString{
          return block.hash;
        }
      },
      //bparent:{
      //  type: GraphQLList(BlockDataRef),
      //  resolve(block){
      //      return block.getBparent(); 
      //  }
      //},
      parent_hash: {
        type : GraphQLString,
        resolve(block){
          return block.parent_hash;
        }
      },
      number: {
        type: GraphQLInt,
        resolve(block){
          return block.number;
        }
      },
      coinbase:{
        type:GraphQLString,
        resolve(block){
          return block.coinbase;
        }
      }
      // coinbase:{
      //   type: AddressStateRef,
      //   resolve(block){
      //     return block.getCoinbase();
      //   }
      // }
    };
  }
});

const RawTransaction = new GraphQLObjectType({
  name: 'RawTransaction',
  description: "A raw transaction",
  fields () {
    return {
      block:{
        type: BlockDataRef,
        resolve(raw_transaction){
          return raw_transaction.getBlock();
        }
      },
      block_number:{
        type: GraphQLInt,
        resolve(raw_transaction){
          return raw_transaction.block_number;
        }
      },
      nonce:{
        type:GraphQLInt,
        resolve(raw_transaction){
          return raw_transaction.nonce;
        }
      },
      from_address:{
        type:GraphQLString,
        resolve(raw_transaction){
          return raw_transaction.from_address;
        }
      },
      to_address:{
        type:GraphQLString,
        resolve(raw_transaction){
          return raw_transaction.to_address;
        }
      },
      recipient:{
        type: AddressStateRef,
        resolve(raw_transaction){
          return raw_transaction.getRecipient();
        }
      },
      sender:{
        type: AddressStateRef,
        resolve(raw_transaction){
          return raw_transaction.getSender();
        }
      }
    };
  }
})

const AddressStateRef = new GraphQLObjectType({
  name: 'AddressStateRef',
  description: "An address state ref",
  fields () {
    return {

      balance:{
        type:GraphQLString,
        resolve(address_state_ref){
          return address_state_ref.balance;
        }
      },
      address:{
        type:GraphQLString,
        resolve(address_state_ref){
          return address_state_ref.address;
        }
      },
      transaction:{
        type:RawTransaction,
        resolve(address_state_ref){
          return address_state_ref.getTransaction(); //acc.hasOne(tx, as: '')
        }
      },
      mined_blocks:{
        type:new GraphQLList(BlockDataRef),
        resolve(address_state_ref){
          return address_state_ref.getBlocks(); // acc.hasMany(block_data_ref, as: 'Blocks')
        }
      },
      incoming:{
        type:new GraphQLList(RawTransaction),
        args: {
          nonce: {
            type: GraphQLInt,
          }
        },
        resolve(raw_transaction, args){
          if(args['nonce'])
            return raw_transaction.getIncoming({where: {'nonce':args['nonce']}}); // tx.hasMany(address_state_ref, as: 'Incoming')
          else
            return raw_transaction.getIncoming(); // tx.hasMany(address_state_ref, as: 'Incoming')
            
        }
      },
      outgoing:{
        type:new GraphQLList(RawTransaction),
        resolve(raw_transaction){
          return raw_transaction.getOutgoing(); // tx.hasMany(address_state_ref, as: 'Outgoing')
        }
      }
    };
  }
})

const EthereumQuery = new GraphQLObjectType({
  name: 'EthereumQuery',
  description: 'Root query object for ethereum',
  fields: () => {
    return {
      mined_blocks: {
        type: new GraphQLList(BlockDataRef),
        args: {
          coinbase: {
            type: GraphQLString
          }
        },
        resolve(root, args){
          return Db.models.block_data_ref.findAll({where:args});
        }
      },
      blocks: {
        type: new GraphQLList(BlockDataRef),
        args: {
          hash: {
            type: GraphQLString
          },
          parent_hash: {
            type: GraphQLString
          },
          number: {
            type: GraphQLInt
          },
          coinbase: {
            type: GraphQLString
          }
        },
        resolve(root, args) {
          return Db.models.block_data_ref.findAll({where: args});
        }
      },
      transactions: {
        type: new GraphQLList(RawTransaction),
        args: {
          nonce: {
            type: GraphQLInt
          },
          from_address: {
            type: GraphQLString
          },
          to_address: {
            type: GraphQLString
          }
        },
        resolve(root, args){
          return Db.models.raw_transaction.findAll({where: args});
        }
      },
      addresses: {
        type: new GraphQLList(AddressStateRef),
        args: {
          balance: {
            type: GraphQLInt
          },
          address: {
            type: GraphQLString
          },
          nonce: {
            type: GraphQLInt
          }
        },
        resolve(root, args){
          return Db.models.address_state_ref.findAll({where: args});
        }
      },

      storageSol:{
        type: new GraphQLList(Storage),
        args: {
          key: {
            type: GraphQLString
          },
          value: {
            type: GraphQLString
          }
        },
        resolve(root, args){
          return Db.models.storage.findAll(
            {
              where: { 
                //args.map(toSolidity)
                //'key': toSolidity(args['key'])
                'value': toSolidity(args['value'])
              }, attributes: ['id', 'address_state_ref_id', 'value', 'key']
            }
          );
        } 
      },

      storage: {
        type: new GraphQLList(Storage),
        args: {
          key: {
            type: GraphQLString
          },
          value: {
            type: GraphQLString
          }
        },
        resolve(root, args){
          return Db.models.storage.findAll({where: args, attributes: ['id', 'address_state_ref_id', 'value', 'key']});
        }
      }
    };
  }
});

// const EthereumMutation = new GraphQLObjectType({
//   name: 'EthereumMutation',
//   description: 'Sending transactions',
//   fields () {
//     return {
//       addPerson: {
//         type: Person,
//         args: {
//           firstName: {
//             type: new GraphQLNonNull(GraphQLString)
//           },
//           lastName: {
//             type: new GraphQLNonNull(GraphQLString)
//           },
//           email: {
//             type: new GraphQLNonNull(GraphQLString)
//           }
//         },
//         resolve (source, args) {
//           return Db.models.person.create({
//             firstName: args.firstName,
//             lastName: args.lastName,
//             email: args.email.toLowerCase()
//           });
//         }
//       }
//     };
//   }
// });

const Schema = new GraphQLSchema({
  query: EthereumQuery
  //, mutation: EthereumMutation
});

export default Schema;
