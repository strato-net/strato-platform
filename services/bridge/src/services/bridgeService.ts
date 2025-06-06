import { config } from "../config";
import { getUserToken } from "../auth";
import BridgeContractCall from "../utils/bridgeContractCall";
import TokenContractCall from "../utils/tokenContractCall";
import sendEmail from "./emailService";
import safeTransactionGenerator, { checkEthTransaction } from "./safeService";
import { fetchCirrusData } from "./cirrusService";

const checkDepositStatus = async (txHash: string): Promise<any | null> => {
  const strippedHash = txHash.toLowerCase().replace(/^0x/, '');
  const data = await fetchCirrusData('MercataEthBridge-depositStatus');

  if (!Array.isArray(data)) return null;
  return data.find((item: any) => item.key?.toLowerCase() === strippedHash) || null;
};

export const stratoTokenBalance = async (
  userAddress: string,
  tokenAddress: string
) => {
  const tokenContract = new TokenContractCall(tokenAddress);
  const balanceData = await tokenContract.balanceOf({
    accountAddress: userAddress,
  });
  return {
    // Convert balance from wei to ether by dividing by 10^18 bignumber using ethers
    balance: balanceData,
  };
};

export const bridgeIn = async (
  ethHash: string,
  tokenAddress: string,
  fromAddress: string,
  amount: string,
  toAddress: string,
  userAddress: string
) => {
  const bridgeContract = new BridgeContractCall();

  const depositResponse = await bridgeContract.deposit({
    txHash: ethHash.toString().replace("0x", ""),
    token: tokenAddress.toLowerCase().replace("0x", ""),
    from: fromAddress.toLowerCase().replace("0x", ""),
    amount: amount.toString(),
    to: toAddress.toLowerCase().replace("0x", ""),
    mercataUser: userAddress.toLowerCase().replace("0x", ""),
  });
  return depositResponse;
};

export const bridgeOut = async (tokenAddress: string, fromAddress: string, amount: string, toAddress: string, userAddress: string) => {
  const generator = await safeTransactionGenerator(amount, toAddress);
  const { value: { hash } } = await generator.next();

  const bridgeContract = new BridgeContractCall();
  await bridgeContract.withdraw({
    txHash: hash.toString().replace("0x", ""),
    token: tokenAddress.toLowerCase().replace("0x", ""),
    from: fromAddress.toLowerCase().replace("0x", ""),
    amount: amount.toString(),
    to: toAddress.toLowerCase().replace("0x", ""),
    mercataUser: userAddress.toLowerCase().replace("0x", ""),
  });

  const { value: { success } } = await generator.next();


  const markPendindResponse = await bridgeContract.markWithdrawalPendingApproval({
    txHash: hash.toString().replace("0x", ""),
  });

  sendEmail(hash.toString());

  return markPendindResponse;
};

// get the possible data from alchemy and verify in this call
export const confirmBridgeIn = async (tx: any) => {
  if (!tx.hash) {
    return null;
  }

  if (!config.bridge?.tokenAddress) {
    return null;
  }

  if (!config.safe?.address) {
    return null;
  }

  // Check deposit status from Mercata endpoint
  const depositStatus = await checkDepositStatus(tx.hash);
  
  if (!depositStatus) {
    return null;
  }

  try {
    const bridgeContract = new BridgeContractCall();
    await bridgeContract.confirmDeposit({
      txHash: depositStatus.key.toString().replace("0x", ""),
      token: config.bridge.tokenAddress.toLowerCase().replace("0x", ""),
      // TODO: get the amount from the deposit status
      to: config.safe.address.toLowerCase().replace("0x", ""),
      amount: '1000000000'.toString(),
      mercataUser: depositStatus.transaction_sender.toLowerCase().replace("0x", ""),
    });
  } catch (error) {
    return null;
  }
};

export const confirmBridgeOut = async (tx: any) => {
  const transactionHash = tx.hash;
  const transaction = await checkEthTransaction(transactionHash);

  if (!transaction) {
    return null;
  }

  const safeTxHash = transaction.safeTxHash.toString().replace("0x", "");

  const bridgeContract = new BridgeContractCall();
  await bridgeContract.confirmWithdrawal({
    txHash: safeTxHash,
  });
}

export const userDepositStatus = async () => {
  return await fetchCirrusData('MercataEthBridge-depositStatus');
}

export const userWithdrawalStatus = async () => {
  return await fetchCirrusData('MercataEthBridge-withdrawStatus');
}