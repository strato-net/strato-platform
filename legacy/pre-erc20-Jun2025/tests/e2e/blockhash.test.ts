import {
  OAuthUser,
  BlockChainUser,
  Options,
  Contract,
  Config,
  rest,
  util,
  fsUtil,
  oauthUtil,
  assert,
  AccessToken
  } from 'blockapps-rest';

const source = `
pragma solidity ^0.4.24;

contract record Random {
  bytes32 value;

  constructor() {
    value = blockhash(block.number - 1);
  }
}
`;

let config:Config = fsUtil.getYaml("config.yaml");
let options:Options = {config: {...config, VM: "SolidVM"}};

describe('Using blockhash', function () {
  xit('should upload a contract that uses blockhash - TODO: reenable once API can correctly distinguish between SolidVM strings and bytes types', async () => {

    const oauth:oauthUtil = await oauthUtil.init(config.nodes[0].oauth);

    let accessToken:AccessToken = await oauth.getAccessTokenByClientSecret();
    const ouser:OAuthUser = {token: accessToken.token.access_token};

    const admin:BlockChainUser = await rest.createUser(ouser, options);

    const contract:Contract = <Contract> await rest.createContract(admin, {source, name: "Random", args:{}}, options);
    const state = await rest.getState(admin, contract, options);
    console.log(`Random state: ${JSON.stringify(state, null, 2)}`);
    assert.notEqual(state.value, 0, "Variable value did not match expected state");
  }); // .timeout(config.timeout);
});
