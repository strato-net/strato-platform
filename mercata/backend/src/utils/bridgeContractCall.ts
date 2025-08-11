import { contractCall } from "./contractCall";

const bridgeContractName = 'MercataEthBridge';
const bridgeContractAddress = process.env.BRIDGE_ADDRESS || '';

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

  async confirmDeposit(args: any) {
    const confirmDepositResponse = await contractCall(bridgeContractName, bridgeContractAddress, "confirmDeposit", args);
    return confirmDepositResponse;
  }

  async confirmWithdrawal(args: any) {
    const confirmWithdrawalResponse = await contractCall(bridgeContractName, bridgeContractAddress, "confirmWithdrawal", args);
    return confirmWithdrawalResponse;
  }

  async batchConfirmWithdrawals(args: any) {
    const batchConfirmWithdrawalsResponse = await contractCall(bridgeContractName, bridgeContractAddress, "batchConfirmWithdrawals", args);
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