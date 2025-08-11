import { contractCall } from "./contractCall";

const bridgeContractName = 'MercataEthBridge';
const bridgeContractAddress = process.env.BRIDGE_CONTRACT_ADDRESS || '';

class BridgeContractCall {
  async deposit(args: any) {
    const depositResponse = await contractCall(bridgeContractName, bridgeContractAddress, "deposit", args);
    return depositResponse;
  }

  async withdraw(args: any) {
    const withdrawResponse = await contractCall(bridgeContractName, bridgeContractAddress, "withdraw", args);
    return withdrawResponse;
  }

  async markWithdrawalPendingApproval(args: any) {
    const markWithdrawalPendingApprovalResponse = await contractCall(bridgeContractName, bridgeContractAddress, "markWithdrawalPendingApproval", args);
    return markWithdrawalPendingApprovalResponse;
  }


}

export default BridgeContractCall; 