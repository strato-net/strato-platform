import { config } from "../config";
import { contractCall } from "./contractCall";

const bridgeContractName = 'MercataEthBridge';
const bridgeContractAddress = config.bridge.address || '';


class BridgeContractCall {
  async deposit(args: any) {
    console.log("deposit contract called")
    const depositResponse = await contractCall(bridgeContractName, bridgeContractAddress, "deposit", args);
    console.log("deposit contractResponse",depositResponse);
    return depositResponse;
  }

  async withdraw(args: any) {
    console.log("withdraw contract called after bridgeOut")
    const withdrawResponse = await contractCall(bridgeContractName, bridgeContractAddress, "withdraw", args);
    console.log("withdraw contractResponse",withdrawResponse);
    return withdrawResponse;
  }

  async markWithdrawalPendingApproval(args: any) {
    console.log("markWithdrawalPendingApproval contract called ....")
    const markWithdrawalPendingApprovalResponse = await contractCall(bridgeContractName, bridgeContractAddress, "markWithdrawalPendingApproval", args);
    console.log("markWithdrawalPendingApproval contract Response",markWithdrawalPendingApprovalResponse);
    return markWithdrawalPendingApprovalResponse;
  }

  async confirmDeposit(args: any) {
    console.log("confirmDeposit contract called")
    const confirmDepositResponse = await contractCall(bridgeContractName, bridgeContractAddress, "confirmDeposit", args);
    console.log("confirmDeposit contract Response",confirmDepositResponse);
    return confirmDepositResponse;
  }

  async confirmWithdrawal(args: any) {
    console.log("confirmWithdrawal contract called ....")
    const confirmWithdrawalResponse = await contractCall(bridgeContractName, bridgeContractAddress, "confirmWithdrawal", args);
    console.log("confirmWithdrawal contract Response",confirmWithdrawalResponse);
    return confirmWithdrawalResponse;
  }

  async batchConfirmWithdrawals(args: any) {
    console.log("batchConfirmWithdrawals contract called......")
    const batchConfirmWithdrawalsResponse = await contractCall(bridgeContractName, bridgeContractAddress, "batchConfirmWithdrawals", args);
    console.log("batchConfirmWithdrawals contract Response",batchConfirmWithdrawalsResponse);
    return batchConfirmWithdrawalsResponse;
  }

  async batchConfirmDeposits(args: any) {
    const response = await contractCall(
      bridgeContractName,
      bridgeContractAddress,
      "batchConfirmDeposits",
      args
    );

    return response;
  }
}

export default BridgeContractCall;
