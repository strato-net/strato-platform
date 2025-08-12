import { config } from "../config";
import { contractCall } from "./contractCall";

const bridgeContractName = 'MercataEthBridge';
const bridgeContractAddress = config.bridge.address || '';


class BridgeContractCall {
  async deposit(args: any) {
    const depositResponse = await contractCall(bridgeContractName, bridgeContractAddress, "deposit", args);
    return depositResponse;
  }

  async depositInitiated(args: any) {
    const depositInitiatedResponse = await contractCall(bridgeContractName, bridgeContractAddress, "deposit", args);
    return depositInitiatedResponse;
  }

  async depositCompleted(args: any) {
    const depositCompletedResponse = await contractCall(bridgeContractName, bridgeContractAddress, "depositCompleted", args);
    return depositCompletedResponse;
  }

  async withdraw(args: any) {
    const withdrawResponse = await contractCall(bridgeContractName, bridgeContractAddress, "withdraw", args);
    return withdrawResponse;
  }

  async markWithdrawalPendingApproval(args: any) {
    const markWithdrawalPendingApprovalResponse = await contractCall(bridgeContractName, bridgeContractAddress, "markWithdrawalPendingApproval", args);
    return markWithdrawalPendingApprovalResponse;
  }

  async confirmDeposit(args: any) {
    const confirmDepositResponse = await contractCall(bridgeContractName, bridgeContractAddress, "confirmDeposit", args);
    return confirmDepositResponse;
  }

  async confirmWithdrawal(args: any) {
    const confirmWithdrawalResponse = await contractCall(bridgeContractName, bridgeContractAddress, "confirmWithdrawal", args);
    return confirmWithdrawalResponse;
  }

  async batchConfirmWithdrawals(args: any) {
    const batchConfirmWithdrawalResponse = await contractCall(bridgeContractName, bridgeContractAddress, "batchConfirmWithdrawals", args);
    return batchConfirmWithdrawalResponse;
  } 

  async finaliseWithdrawal(args: any) {
    const finaliseWithdrawalResponse = await contractCall(bridgeContractName, bridgeContractAddress, "finaliseWithdrawal", args);
    return finaliseWithdrawalResponse;
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
