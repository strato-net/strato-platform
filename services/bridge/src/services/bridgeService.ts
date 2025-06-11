import {
  config,
  MAINNET_ERC20_TOKEN_CONTRACTS,
  MAINNET_ETH_STRATO_TOKEN_MAPPING,
  TESTNET_ERC20_TOKEN_CONTRACTS,
  TESTNET_ETH_STRATO_TOKEN_MAPPING,
} from "../config";
import BridgeContractCall from "../utils/bridgeContractCall";
import TokenContractCall from "../utils/tokenContractCall";
import sendEmail from "./emailService";
import safeTransactionGenerator, { checkEthTransaction } from "./safeService";
import {
  fetchDepositInitiated,
  fetchDepositInitiatedStatus,
  fetchWithdrawalInitiatedStatus,
} from "./cirrusService";
import {
  TESTNET_ETH_TOKENS,
  MAINNET_ETH_TOKENS,
  TESTNET_STRATO_TOKENS,
  MAINNET_STRATO_TOKENS,
} from "../config";

const showTestnet = process.env.SHOW_TESTNET === "true";

const checkDepositStatus = async (txHash: string): Promise<any | null> => {
  console.log("checking deposit status for .......", txHash);
  const strippedHash = txHash.toLowerCase().replace(/^0x/, "");
  let data;
  for (let i = 0; i < 3; i++) {
    data = await fetchDepositInitiated(strippedHash);
    if (data) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return data[0];
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

  console.log("bridgeIn contract call 1st step", {
    txHash: ethHash.toString().replace("0x", ""),
    token: tokenAddress.toLowerCase().replace("0x", ""),
    from: fromAddress.toLowerCase().replace("0x", ""),
    amount: amount.toString(),
    to: toAddress.toLowerCase().replace("0x", ""),
  });

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

export const bridgeOut = async (
  tokenAddress: string,
  fromAddress: string,
  amount: string,
  toAddress: string,
  userAddress: string
) => {
  console.log("bridgeOut contract call 1st step", {
    token: tokenAddress.toLowerCase().replace("0x", ""),
    from: fromAddress.toLowerCase().replace("0x", ""),
    amount: amount.toString(),
    to: toAddress.toLowerCase().replace("0x", ""),
    mercataUser: userAddress.toLowerCase().replace("0x", ""),
  });

  const isTestnet = process.env.SHOW_TESTNET === "true";
  const tokenContract = isTestnet
    ? TESTNET_ERC20_TOKEN_CONTRACTS
    : MAINNET_ERC20_TOKEN_CONTRACTS;

    const tokenMapping = isTestnet
      ? TESTNET_ETH_STRATO_TOKEN_MAPPING
      : MAINNET_ETH_STRATO_TOKEN_MAPPING;
  
    const ethTokenAddress: any =
      Object.entries(tokenMapping).find(
        ([_, value]) => value.toLowerCase() === tokenAddress.toLowerCase()
      )?.[0] || null;

  const isERC20 = tokenContract.find((token: any) => token === ethTokenAddress);

  const generator = await safeTransactionGenerator(
    amount,
    toAddress,
    isERC20 ? "erc20" : "eth",
    ethTokenAddress
  );
  const {
    value: { hash },
  } = await generator.next();

  console.log(
    "txhash for withdraw contract ....",
    hash.toString().replace("0x", "")
  );

  const bridgeContract = new BridgeContractCall();
  await bridgeContract.withdraw({
    txHash: hash.toString().replace("0x", ""),
    token: tokenAddress.toLowerCase().replace("0x", ""),
    from: fromAddress.toLowerCase().replace("0x", ""),
    amount: amount.toString(),
    to: toAddress.toLowerCase().replace("0x", ""),
    mercataUser: userAddress.toLowerCase().replace("0x", ""),
  });

  const {
    value: { success },
  } = await generator.next();

  const markPendindResponse =
    await bridgeContract.markWithdrawalPendingApproval({
      txHash: hash.toString().replace("0x", ""),
    });

  sendEmail(hash.toString());

  return markPendindResponse;
};

// get the possible data from alchemy and verify in this call
export const confirmBridgeIn = async (tx: any) => {
  console.log("confirmBridgeIn called.....", tx);
  console.log("confirmbridgeIn tx.hash", tx.hash);
  if (!config.safe?.address) {
    return null;
  }

  // Check deposit status from Mercata endpoint
  const depositStatus = await checkDepositStatus(tx.hash);
  console.log("depositStatus checked ...", depositStatus);

  if (!depositStatus) {
    return null;
  }

  try {
    const bridgeContract = new BridgeContractCall();
    console.log({
      txHash: depositStatus.txHash.toString().replace("0x", ""),
      token: depositStatus.token.toLowerCase().replace("0x", ""),
      to: config.safe.address.toLowerCase().replace("0x", ""),
      amount: depositStatus.amount.toString(),
      mercataUser: depositStatus.mercataUser.toLowerCase().replace("0x", ""),
    });
    await bridgeContract.confirmDeposit({
      txHash: depositStatus.txHash.toString().replace("0x", ""),
      token: depositStatus.token.toLowerCase().replace("0x", ""),
      to: config.safe.address.toLowerCase().replace("0x", ""),
      amount: depositStatus.amount.toString(),
      mercataUser: depositStatus.mercataUser.toLowerCase().replace("0x", ""),
    });
  } catch (error) {
    console.log("error in confirmBridgeIn", error);
    return null;
  }
};

export const confirmBridgeOut = async (tx: any) => {
  console.log("confirmBridgeOut called.....", tx);
  console.log("confirmBridgeOut tx.hash", tx.hash);
  const transactionHash = tx.hash;
  const transaction = await checkEthTransaction(transactionHash);
  console.log("transaction checked ....", transaction);
  if (!transaction) {
    return null;
  }

  const safeTxHash = transaction.safeTxHash.toString().replace("0x", "");

  const bridgeContract = new BridgeContractCall();
  await bridgeContract.confirmWithdrawal({
    txHash: safeTxHash,
  });
};

export const userDepositStatus = async (
  status: string,
  limit?: number,
  orderBy?: string,
  orderDirection?: string,
  pageNo?: string
) => {
  return await fetchDepositInitiatedStatus(
    status,
    limit,
    orderBy,
    orderDirection,
    pageNo
  );
};

export const userWithdrawalStatus = async (
  status: string,
  limit?: number,
  orderBy?: string,
  orderDirection?: string,
  pageNo?: string
) => {
  return await fetchWithdrawalInitiatedStatus(
    status,
    limit,
    orderBy,
    orderDirection,
    pageNo
  );
};

export const getBridgeInNetworks = async (bridgeType: string) => {
  if (bridgeType === "bridgeIn") {
    if (showTestnet) {
      return {
        networkTokens: TESTNET_ETH_TOKENS,
      };
    } else {
      return {
        networkTokens: MAINNET_ETH_TOKENS,
      };
    }
  } else if (bridgeType === "bridgeOut") {
    if (showTestnet) {
      return {
        networkTokens: TESTNET_STRATO_TOKENS,
      };
    } else {
      return {
        networkTokens: MAINNET_STRATO_TOKENS,
      };
    }
  }
  return null;
};
