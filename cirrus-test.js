var Promise = require("bluebird");
var chalk = require('chalk')
var argv = require('minimist')(process.argv.slice(2));
var _ = require('lodash/fp');
var __ = require('lodash'); // not pretty but how else to use __.map((k,v) => {...}) ?
var kafka = Promise.promisifyAll(require('kafka-node'));
var crypto = require('crypto');

console.log("I'm " + chalk.red(argv.role))

var chain = "deeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeed5";
var stateDiff_chain = "stateDiff_" + chain;
var contractNew_chain = "contractNew_" + chain;

var zookeeperHost = (process.env.ZOOKEEPER || 'zookeeper:2181');
var client = new kafka.Client(zookeeperHost);
var producer = new kafka.HighLevelProducer(client, {partitionerType: 0}); 
var offsetter = new kafka.Offset(client); 

function leftpad (str, len, ch) {
  str = String(str);
  var i = -1;
  if (!ch && ch !== 0) ch = ' ';
  len = len - str.length;
  while (++i < len) {
    str = ch + str;
  }
  return str;
}

function randHex(n) {
  return crypto.randomBytes(n).toString('hex');
}

function randomCodeHash() {
  return "abba" + (Math.random()*11|0);
}

function callNTimes(n, time, fn) {
  var i = n;
  function callFn() {
    if (--n < 0) return;
      fn(-(n-i));
      setTimeout(callFn, time);
    }
  setTimeout(callFn, time);
}

var randomContractNew = function () {
  return {
    codeHash: "989ad6524e83e1a38b485bb898d27b5dbc65fc33905c3d3a2fd41c5bb91c3fc8",
    xAbi: JSON.stringify(sampleXabi)
  }
}

var randomStateDiff = function () {
  var toRet =  
    {
      createdAccounts:{},
      updatedAccounts:randomSimpleStorageDiff(),
      deletedAccounts:{}
    };
  return toRet;
}

var randomSimpleStorageDiff = function(){
  var address = randHex(46);
  var amount = leftpad(randHex(6), 64, 0);
  var acc = {};
  acc[address] = 
     {
      contractRoot:{
        oldValue:"56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
        newValue:"3d060ab22dfb38810db7dd1bd799f455752baea6f1417b9468cd6eb1aec9cb1f"
      },
      balance:null,
      storage:{
        "0000000000000000000000000000000000000000000000000000000000000000":{
          newValue: amount
        }
      },
      codeHash:"989ad6524e83e1a38b485bb898d27b5dbc65fc33905c3d3a2fd41c5bb91c3fc8",
      code:null,
      nonce:null
    };
  return acc;
}

var sampleXabi = {
  bin:"606060405260978060106000396000f360606040526000357c01000000000000000000000000000000000000000000000000000000009004806360fe47b11460415780636d4ce63c14605757603f565b005b605560048080359060200190919050506078565b005b606260048050506086565b6040518082815260200191505060405180910390f35b806000600050819055505b50565b600060006000505490506094565b9056",
  "bin-runtime":"60606040526000357c01000000000000000000000000000000000000000000000000000000009004806360fe47b11460415780636d4ce63c14605757603f565b005b605560048080359060200190919050506078565b005b606260048050506086565b6040518082815260200191505060405180910390f35b806000600050819055505b50565b600060006000505490506094565b9056",
  codeHash:"989ad6524e83e1a38b485bb898d27b5dbc65fc33905c3d3a2fd41c5bb91c3fc8",
  xabi:{
    funcs:{
      set:{
        args:{
          x:{
            type:"Int",
            index:0,
            bytes:32,
            name:"x"
          }
        },
        selector:"60fe47b1",
        vals:{}
      },
      get:{
        args:{},
        selector:"6d4ce63c",
        vals:{
          retVal:{
            type:"Int",
            index:0,
            bytes:32
          }
        }
      }
    },
    vars:{
      storedData:{
        atBytes:0,
        type:"Int",
        bytes:32
      }
    }
  },
  name:"SimpleStorage",
  address:"85dd186fc6d0fd8bae332f58fc506410fc87a9d7"
}

var sampleStateDiff = {
  createdAccounts:{},
  blockHash:"7766e9ea50411e25ddd3afa0274f2f47ab176c638ea98e3406485dba2628207c",
  deletedAccounts:{},
  updatedAccounts:{
    "9709d6f5f2e90c5dd7b69fb9ef3a9d9e7ddf81e9":{
      contractRoot:null,
      balance:{
        oldValue:999996990950000000000,
        newValue:999994910850000000000
      },
      storage:{},
      codeHash:"c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
      code:null,
      nonce:{
        oldValue:1,
        newValue:2
      }
    },
    "09c5fdeaf47518916dd5991bf1cf4afc41148b31":{
      contractRoot:null,
      balance:{
        oldValue:70025704350000000000,
        newValue:75027784450000000000
      },
      "storage":{},
      codeHash:"c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
      code:null,
      nonce:null
    },
    "741f7a873f077d55cdf6d6a2b9a05e23cb6c68b3":{
      contractRoot:{
        oldValue:"56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
        newValue:"3d060ab22dfb38810db7dd1bd799f455752baea6f1417b9468cd6eb1aec9cb1f"
      },
      balance:null,
      storage:{
        "0000000000000000000000000000000000000000000000000000000000000000":{
          newValue:"0000000000000000000000000000000000000000000000000000000000000011"
          }
        },
        codeHash:"989ad6524e83e1a38b485bb898d27b5dbc65fc33905c3d3a2fd41c5bb91c3fc8",
        code:null,
        nonce:null
      }
    },
    blockNumber:15
  }; 

var sampleStateDiffMessage = { 
  topic: 'statediff_0600bb655cc29fbe29d592b657947e26aa0b8d43',
  value: JSON.stringify(sampleStateDiff),
  offset: 14,
  partition: 0,
  key: -1 
};

var streamTopic = function(topic, offset){

  return offsetter
    .fetchLatestOffsetsAsync([topic])
    .get(topic)
    .get(0)
    .then(offset => {
      console.log(topic + " offset is: " + offset);
      return new kafka.Consumer(
        client,
        [{
          topic: topic,
          offset: topic == true ? offset : 0,
          partition: 0
        }],
        {fromOffset: true}
      );
    })
}

global.hashMap = {};
var once = function(hash, f){
  if(hash in global.hashMap == false){
    console.log("First call: " + hash);
    var toRet = f();
    global.hashMap[hash] = toRet;
    return toRet;
  }
}

switch (argv.role) {

  // vm :: IO [StateDiff]
  case 'vm':
    producer.on('ready', function () {
      producer.createTopics([stateDiff_chain], console.log);

      // for when partitionerType = 3
      // see https://github.com/SOHU-Co/kafka-node/issues/354
      // client.refreshMetadata();
      
      callNTimes(9999999999, 4000, n => {
        producer.send([{ topic: stateDiff_chain, messages: JSON.stringify(randomStateDiff()), partition: 0 }], console.log)
      });
    });
    producer.on('error', console.log)
 
    break;
  
  // bloc :: IO [ContractNew]
  case 'bloc':
    producer.on('ready', function () {
      producer.createTopics([contractNew_chain], console.log);
      callNTimes(9999999999, 8000, n => {
        producer.send([{ topic: contractNew_chain, messages: randomContractNew(), partition: 0 }], console.log)
      });
    });
    producer.on('error', console.log)

    break;
  
  // cirrus :: [FullState] -> [ContractNew] -> IO ()
  case 'cirrus':
    streamTopic('fullState', false)
    .call('on', 'message', m => {
      console.log("m:" + JSON.stringify(m));
    })
    .call('on', 'error', console.log);

   break;

  // birrus :: [StateDiff] -> [ContractNew] -> [FullState]
  case 'birrus':
    streamTopic(stateDiff_chain, false)
    .call('on', 'message', m => {
      //console.log("m:" + JSON.stringify(m));
      //var state = "Failed to parse incoming message!";
      //try {
      //  state = JSON.parse(m.value);
      //} catch (err) {
      //  console.log("Failed to parse: " + err);
      //}
      var fsTopic = "fullState_" + randomCodeHash();
      //console.log(JSON.stringify(state));
      //if(Object.keys(state.updatedAccounts).length > 0){
      //producer.on('ready', function () {
        once(fsTopic, _ => { producer.createTopics([fsTopic], console.log)}) 
        producer.send([{ topic: fsTopic, messages: "A STATE", partition: 0 }], console.log)
      //})
      //}
    })
    .call('on', 'error', console.log); 

    break;
  
  default:
    console.log("Not a real role");
    break;
}

