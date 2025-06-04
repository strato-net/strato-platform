import BridgeContractCall from "../utils/bridgeContractCall";
import TokenContractCall from "../utils/tokenContractCall";
import sendEmail from "./emailService";
import safeTransactionGenerator, { checkEthTransaction } from "./safeService";

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

  console.log('hash', hash);

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
  console.log('Transaction proposed:', success);

  const markPendindResponse = await bridgeContract.markWithdrawalPendingApproval({
    txHash: hash.toString().replace("0x", ""),
  });

  sendEmail(hash.toString());

  return markPendindResponse;
};

// get the possible data from alchemy and verify in this call
export const confirmBridgeIn = async (tx: any) => {
  // const transactionHash = tx.hash;
  // // TODO: call cirrus API to get the info about the tx using eth hash make a cirrus service for this
  // const transaction = await checkEthTransaction(transactionHash);

  // if (!transaction) {
  //   return;
  // }

  // // TODO: call cirrus API to get the info about the tx using eth hash make a cirrus service for this

  // const bridgeContract = new BridgeContractCall();
  // await bridgeContract.confirmDeposit({
  //   txHash: ethHash.toString().replace("0x", ""),
  //   token: tokenAddress.toLowerCase().replace("0x", ""),
  //   to: toAddress.toLowerCase().replace("0x", ""),
  //   amount: amount.toString(),
  //   mercataUser: userAddress.toLowerCase().replace("0x", ""),
  // });
}

export const confirmBridgeOut = async (tx: any) => {
  const transactionHash = tx.hash;
  const transaction = await checkEthTransaction(transactionHash);

  if (!transaction) {
    return;
  }

  const safeTxHash = transaction.safeTxHash.toString().replace("0x", "");

  console.log("transaction", safeTxHash);

  const bridgeContract = new BridgeContractCall();
  await bridgeContract.confirmWithdrawal({
    txHash: safeTxHash,
  });
}
