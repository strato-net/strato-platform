import axios from 'axios';
import { fsUtil, 
  rest, 
  assert, 
  Config, 
  oauthUtil, 
  AccessToken,
  OAuthUser,
  BlockChainUser } from 'blockapps-rest';

let config:Config = fsUtil.getYaml("config.yaml");

const options = { config };
const contractName = 'CirrusAccessTest';
const abstractContractName = `A${contractName}`
const commonName = "Test"
const tableName = `${commonName}-${abstractContractName}`
const contractSrc = `
pragma solidvm 11.4;

abstract contract ${abstractContractName} {
  int x;
  constructor(int _x) {
    x = _x;
  }
}

contract ${contractName} is ${abstractContractName} {
  constructor(int _x) ${abstractContractName}(_x) { }
}`;

describe('postgREST allowed methods', function () {
  this.timeout(60000);
  let admin:BlockChainUser
  before(async () => {
    const oauth:oauthUtil = await oauthUtil.init(config.nodes[0].oauth);

    let accessToken:AccessToken = await oauth.getAccessTokenByClientSecret();
    const ouser:OAuthUser = {token: accessToken.token.access_token};

    admin = await rest.createUser(ouser, options);
    const res = await rest.createContract(admin, {
      name: contractName,
      source: contractSrc,
      args: {
        _x: 7,
      },
    }, options);
  });
  it('Cannot create a new row - POST 403 Forbidden', async () => {
    try {
      const axRes = await axios.post(`${config.nodes[0].url}/cirrus/search/${tableName}`, {
        x: 15,
        address: 'deadbeef',
        chainId: 'abcdef',
        block_hash: 'deadbeef',
        block_timestamp: '9999-12-31 12:12:12 UTC',
        block_number: 'deadbeef',
        transaction_hash: 'deadbeef',
        transaction_sender: 'deadbeef',
      }, {
        headers: {
          Authorization: `Bearer ${admin.token}`,
          Accept: 'application/json',
        },
      });
      assert.notEqual(axRes.status, 200, 'Successful POST request');
    } catch (err) {
      assert.equal(err.response.status, 403)
    }
  });
  it('Cannot update an existing row - PATCH 403 Forbidden', async () => {
    try {
      const axRes = await axios.patch(`${config.nodes[0].url}/cirrus/search/${tableName}?x=lt.10&limit=1`, {
        x: 100,
        address: '02345de',
        chainId: 'deadbeef',
        block_hash: 'deadbeef',
        block_timestamp: '9999-12-31 12:12:12 UTC',
        block_number: 'deadbeef',
        transaction_hash: 'deadbeef',
        transaction_sender: 'deadbeef',
      }, {
        headers: {
          Authorization: `Bearer ${admin.token}`,
          Accept: 'application/json',
        },
      });
      assert.notEqual(axRes.status, 200, 'Successful PATCH request');
    } catch (err) {
      assert.equal(err.response.status, 403)
    }
  });
  it('Can GET rows from a table - GET 200 Success', async () => {
    const axRes = await axios.get(`${config.nodes[0].url}/cirrus/search/${tableName}`, {
      headers: {
        Authorization: `Bearer ${admin.token}`,
        Accept: 'application/json',
      },
    });
    assert.equal(axRes.status, 200, `Actually recieved status: ${axRes.status}`);
  });
});
