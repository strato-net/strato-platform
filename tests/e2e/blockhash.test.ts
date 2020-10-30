import { OAuthUser, BlockChainUser, Options, Contract, Config, rest, util, fsUtil, oauthUtil, assert } from 'blockapps-rest';

const source = `
pragma solidity ^0.4.24;

contract Random {
  bytes32 value;

  constructor() {
    value = blockhash(block.number - 1);
  }
}
`;

var options:Options = {config: fsUtil.getYaml("config.yaml")};

describe('Using blockhash', function () {
  it('should upload a contract that uses blockhash', async () => {

    const oauth:oauthUtil = oauthUtil.init(options.config.nodes[0].oauth);

    let ouser:OAuthUser = await oauth.getAccessTokenByClientSecret();

    const admin:BlockChainUser = await rest.createUser(ouser, options);

    const contract:Contract = <Contract> await rest.createContract(admin, {source, name: "Random", args:{}}, options);
    const state = await rest.getState(admin, contract, options);
    console.log(`Random state: ${JSON.stringify(state, null, 2)}`);
    assert.notEqual(state.value, 0, "Variable value did not match expected state");
  }).timeout(10000);
});
