const { contractCall, contractCallView } = require("./contractCall");

const tokenContractName = 'Token';

class TokenContractCall {
  constructor(contractAddress) {
    this.contractAddress = contractAddress;
  }

  async balanceOf(accountAddress, adminToken = null) {
    try {
      // Use contractCall (transaction endpoint) since contractCallView returns HTML
      const result = await contractCall(tokenContractName, this.contractAddress, "balanceOf", { accountAddress }, adminToken);
      return result.data.contents[0]; // Extract the balance from data.contents[0]
    } catch (error) {
      console.warn(`Could not get balance for ${accountAddress} on ${this.contractAddress}:`, error.message);
      return "0";
    }
  }

  async totalSupply(adminToken = null) {
    try {
      // Use contractCall (transaction endpoint) since contractCallView returns HTML
      const result = await contractCall(tokenContractName, this.contractAddress, "totalSupply", {}, adminToken);
      return result.data.contents[0]; // Extract the supply from data.contents[0]
    } catch (error) {
      console.warn(`Could not get total supply for ${this.contractAddress}:`, error.message);
      return "0";
    }
  }

  async approve(spender, value, adminToken = null) {
    const result = await contractCall(tokenContractName, this.contractAddress, "approve", { spender, value }, adminToken);
    return result;
  }

  async mint(account, value, adminToken = null) {
    const result = await contractCall(tokenContractName, this.contractAddress, "mint", { account, value }, adminToken);
    return result;
  }

  async setStatus(newStatus, adminToken = null) {
    const result = await contractCall(tokenContractName, this.contractAddress, "setStatus", { newStatus }, adminToken);
    return result;
  }
}

module.exports = TokenContractCall;
