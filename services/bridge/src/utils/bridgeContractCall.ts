import { config } from "../config";
import { contractCall } from "./contractCall";

const bridgeContractName = 'MercataEthBridge';
const bridgeContractAddress = config.bridge.address || '';

class BridgeContractCall {
  async deposit(args: any) {
    const depositResponse = await contractCall(bridgeContractName, bridgeContractAddress, "deposit", args);
    console.log("depositResponse",depositResponse);
    return depositResponse;
  }

  async withdraw(args: any) {
    const withdrawResponse = await contractCall(bridgeContractName, bridgeContractAddress, "withdraw", args);
    console.log("withdrawResponse",withdrawResponse);
    return withdrawResponse;
  }

  async markWithdrawalPendingApproval(args: any) {
    const markWithdrawalPendingApprovalResponse = await contractCall(bridgeContractName, bridgeContractAddress, "markWithdrawalPendingApproval", args);
    console.log("markWithdrawalPendingApprovalResponse",markWithdrawalPendingApprovalResponse);
    return markWithdrawalPendingApprovalResponse;
  }

  async confirmDeposit(args: any) {
    const confirmDepositResponse = await contractCall(bridgeContractName, bridgeContractAddress, "confirmDeposit", args);
    console.log("confirmDepositResponse",confirmDepositResponse);
    return confirmDepositResponse;
  }

  async confirmWithdrawal(args: any) {
    const confirmWithdrawalResponse = await contractCall(bridgeContractName, bridgeContractAddress, "confirmWithdrawal", args);
    console.log("confirmWithdrawalResponse",confirmWithdrawalResponse);
    return confirmWithdrawalResponse;
  }
}

export default BridgeContractCall;
