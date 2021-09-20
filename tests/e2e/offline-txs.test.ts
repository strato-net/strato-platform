import {oauthUtil} from "blockapps-rest";

const { promisify } = require('util');
const exec = promisify(require("child_process").exec)
import { assert } from 'chai';
const fsPromises = require('fs').promises


describe('Test Offline Transactions', async function () {
  this.timeout(20000);
  
  let dockerPrefix
  let x509UserData
  let nonceCounter = 0

  const getSimpleStorageCountFromCirrus = async function () {
    const cirrusResp = await exec(dockerPrefix + 'docker exec strato_postgrest_1 curl localhost:3001/SimpleStorageTest')
    return cirrusResp.stdout.split('transaction_hash').length - 1
  }

  before(async function () {
    try {
      await exec('docker ps');
      dockerPrefix = '';
    } catch(err) {
      // TODO: make sure if the error is actually due to the sudo required
      dockerPrefix = 'sudo ';
    }
    const keygenRes = await exec(dockerPrefix + 'docker exec strato_strato_1 bash -c "x509-keygen"');
    const keygenResJson = '{' + keygenRes.stdout.trim().split('{').pop().split('}')[0] + '}';
    x509UserData = JSON.parse(keygenResJson)
    
    const gasOn = await exec(dockerPrefix + 'docker exec strato_strato_1 env | grep gasOn');
    if (gasOn.stdout.split('=')[1] === 'true') {
      await exec(dockerPrefix + `docker exec strato_strato_1 bash -c "curl -s -X POST 'http://localhost:3000/bloc/v2.2/users/user/${x509UserData.address}/fill?resolve=true'"`)
    }
    // Create SimpleStorageN.sol files inside container
    await fsPromises.writeFile('SimpleStorage1.sol', 'contract SimpleStorageTest {uint storedData; function SimpleStorageTest() {storedData = 1;} function set(uint x) {storedData = x;} function get() constant returns (uint) {return storedData;}}')
    await fsPromises.writeFile('SimpleStorage2.sol', 'contract SimpleStorageTest {uint storedData2; function SimpleStorageTest() {storedData2 = 2;} function set(uint x) {storedData2 = x;} function get() constant returns (uint) {return storedData2;}}')
    await exec(dockerPrefix + 'docker cp SimpleStorage1.sol strato_strato_1:/var/lib/strato/');
    await exec(dockerPrefix + 'docker cp SimpleStorage2.sol strato_strato_1:/var/lib/strato/');
  });

  it('should create the x509 certificate using x509-keygen in "before" script', async function () {
    assert.typeOf(x509UserData.privateKey, 'string', 'x509UserData.privateKey must be a string')
    assert.typeOf(x509UserData.publicKey, 'string', 'x509UserData.publicKey must be a string')
    assert.typeOf(x509UserData.address, 'string', 'x509UserData.address must be a string')
    assert.isOk(x509UserData.privateKey, 'x509UserData.privateKey should contain a private key')
    assert.isOk(x509UserData.publicKey, 'x509UserData.publicKey should contain a public key')
    assert.isOk(x509UserData.address, 'x509UserData.address should contain an address')
  });

  it ('should create contract using offline tx', async function () {
    const ssCount1 = await getSimpleStorageCountFromCirrus()
    let ssCount2
    const ss1Resp = await exec(dockerPrefix + `docker exec strato_strato_1 post-raw-transaction --contract=SimpleStorageTest --source=SimpleStorage1.sol --key=priv.pem --nonce=${nonceCounter}`)
    nonceCounter+=1
    const startTimestamp = +new Date()
    do {
      ssCount2 = await getSimpleStorageCountFromCirrus()
      console.log('ssCount1='+ssCount1+'; ssCount2='+ssCount2)
    } while (
        (ssCount2 - ssCount1 < 1) && (+new Date()) <= startTimestamp + 10000
        )
    assert.equal(ssCount2 - ssCount1, 1, 'expected 1 more SimpleStorageTest contracts in cirrus response')
  });

  it ('should create different contracts without collisions under same name using offline tx', async function () {
    const ssCount1 = await getSimpleStorageCountFromCirrus()
    let ssCount2
    const ss1Resp = await exec(dockerPrefix + `docker exec strato_strato_1 post-raw-transaction --contract=SimpleStorageTest --source=SimpleStorage1.sol --key=priv.pem --nonce=${nonceCounter}`)
    nonceCounter+=1
    const ss2Resp = await exec(dockerPrefix + `docker exec strato_strato_1 post-raw-transaction --contract=SimpleStorageTest --source=SimpleStorage2.sol --key=priv.pem --nonce=${nonceCounter}`)
    nonceCounter+=1

    const startTimestamp = +new Date()
    do {
      ssCount2 = await getSimpleStorageCountFromCirrus()
      console.log('ssCount1='+ssCount1+'; ssCount2='+ssCount2)
    } while (
      (ssCount2 - ssCount1 < 2) && (+new Date()) <= startTimestamp + 10000
    )
    assert.equal(ssCount2 - ssCount1, 2, 'expected 2 more SimpleStorageTest contracts in cirrus response')
  });

  it ('should make function call using offline tx', async function () {
    const ssCount1 = await getSimpleStorageCountFromCirrus()
    let ssCount2
    const ss1Resp = await exec(dockerPrefix + `docker exec strato_strato_1 post-raw-transaction --contract=SimpleStorageTest --source=SimpleStorage1.sol --key=priv.pem --nonce=${nonceCounter}`)
    nonceCounter+=1
    const startTimestamp = +new Date()
    do {
      ssCount2 = await getSimpleStorageCountFromCirrus()
    } while (
      (ssCount2 - ssCount1 < 1) && (+new Date()) <= startTimestamp + 10000
    )
    // Get address from post-raw-transaction response:
    const ss1Addr = ss1Resp.stdout.split('transactionResultContractsCreated = "')[1].split(',')[0]
    const valueToSet = 123
    const funcCallResp = await exec(dockerPrefix + `docker exec strato_strato_1 post-raw-transaction -f --funcName=set --args='${valueToSet}' --key=priv.pem --address=${ss1Addr} --nonce=${nonceCounter}`)
    nonceCounter+=1
    const startTimestamp2 = +new Date()
    let ssVarVal
    do {
      const ssCirrusResp = await exec(dockerPrefix + 'docker exec strato_postgrest_1 curl localhost:3001/SimpleStorageTest')
      const ssCirrusRespSplit = ssCirrusResp.stdout.split('"storedData":')
      ssVarVal = ssCirrusRespSplit[ssCirrusRespSplit.length - 1].split(',')[0]
      console.log('ssVarVal=' + ssVarVal)
    } while (
      (ssVarVal !== '123') && (+new Date()) <= startTimestamp2 + 10000
    )
    assert.equal(ssVarVal, '123', 'expected to set the storedData var value to 123')
  });
  
  after(async function () {
    await exec ('rm -rf SimpleStorage*.sol')
  })
  
});
