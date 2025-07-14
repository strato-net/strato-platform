import {
  config,
  getExchangeTokenInfoBridgeIn,
  getExchangeTokenInfoBridgeOut,
  MAINNET_ERC20_TOKEN_CONTRACTS,
  MAINNET_ETH_STRATO_TOKEN_MAPPING,
  TESTNET_ERC20_TOKEN_CONTRACTS,
  TESTNET_ETH_STRATO_TOKEN_MAPPING,
} from "../config";
import BridgeContractCall from "../utils/bridgeContractCall";
import TokenContractCall from "../utils/tokenContractCall";
import sendEmail from "./emailService";
import safeTransactionGenerator, {
  checkEthTransaction,
} from "./safeService";
import {
  fetchDepositInitiated,
  fetchDepositInitiatedStatus,
  fetchDepositInitiatedTransactions,
  fetchWithdrawalInitiatedStatus,
} from "./cirrusService";
import {
  TESTNET_ETH_TOKENS,
  MAINNET_ETH_TOKENS,
  TESTNET_STRATO_TOKENS,
  MAINNET_STRATO_TOKENS,
} from "../config";
import { mintVouchersForDeposits } from "../utils/voucherMinting";
import { ethers } from "ethers";
import axios from "axios";

const showTestnet = process.env.SHOW_TESTNET === "true";

// ERC-20 Transfer event signature
const TRANSFER_EVENT_SIG = ethers.id("Transfer(address,address,uint256)");

const ALCHEMY_URL = process.env.SHOW_TESTNET === 'true' ? 'https://eth-sepolia.g.alchemy.com/v2' : 'https://eth-mainnet.g.alchemy.com/v2';

// Wait for transaction to be mined
const waitForTransactionMined = async (txHash: string, maxAttempts: number = 10): Promise<boolean> => {
  console.log(`Waiting for transaction ${txHash} to be mined...`);
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await axios.post(`${ALCHEMY_URL}/${config.alchemy.apiKey}`, {
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getTransactionReceipt',
        params: [txHash],
      });

      const receipt = response.data?.result;
      
      if (receipt && receipt.status === '0x1') {
        console.log(`✅ Transaction ${txHash} mined successfully on attempt ${attempt}`);
        return true;
      } else if (receipt && receipt.status === '0x0') {
        console.log(`❌ Transaction ${txHash} failed on attempt ${attempt}`);
        return false;
      } else {
        console.log(`⏳ Transaction ${txHash} not yet mined, attempt ${attempt}/${maxAttempts}`);
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
      }
    } catch (error: any) {
      console.error(`Error checking transaction status on attempt ${attempt}:`, error.message);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  console.log(`⏰ Transaction ${txHash} not mined after ${maxAttempts} attempts`);
  return false;
};

// Validate transaction details using Alchemy
const validateTransactionWithAlchemy = async (
  txHash: string,
  stratoTokenAddress: string,
  stratoAmount: string,
): Promise<{ isValid: boolean; error?: string }> => {
  try {
    console.log(`Validating transaction ${txHash} with Alchemy...`);
    
    // Wait for transaction to be mined first
    const isMined = await waitForTransactionMined(txHash);
    if (!isMined) {
      return { isValid: false, error: 'Transaction not mined or failed' };
    }
    
    // Map Strato token address to Ethereum token address
    const isTestnet = process.env.SHOW_TESTNET === "true";
    const tokenMapping = isTestnet
      ? TESTNET_ETH_STRATO_TOKEN_MAPPING
      : MAINNET_ETH_STRATO_TOKEN_MAPPING;
    
    const ethTokenAddress = Object.entries(tokenMapping).find(
      ([_, stratoAddr]) => stratoAddr.toLowerCase() === stratoTokenAddress.toLowerCase()
    )?.[0];
    
    if (!ethTokenAddress) {
      return { isValid: false, error: `No Ethereum mapping found for Strato token: ${stratoTokenAddress}` };
    }
    
    console.log(`Mapped Strato token ${stratoTokenAddress} to Ethereum token ${ethTokenAddress}`);
    
    const [receiptRes, txRes] = await Promise.all([
      axios.post(`${ALCHEMY_URL}/${config.alchemy.apiKey}`, {
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getTransactionReceipt',
        params: [txHash],
      }),
      axios.post(`${ALCHEMY_URL}/${config.alchemy.apiKey}`, {
        jsonrpc: '2.0',
        id: 2,
        method: 'eth_getTransactionByHash',
        params: [txHash],
      }),
    ]);

    const receipt = receiptRes.data?.result;
    const tx = txRes.data?.result;

    if (!receipt || !tx) {
      return { isValid: false, error: 'Transaction not found' };
    }

    const lowerEthToken = ethTokenAddress.toLowerCase();
    const logs = receipt?.logs ?? [];

    // Check for ETH transfer
    const isETHTransfer = 
      lowerEthToken === "0x0000000000000000000000000000000000000000" &&
      BigInt(tx.value).toString() === stratoAmount &&
      tx.to?.toLowerCase() === config.safe.address?.toLowerCase();

    // Check for ERC-20 transfer
    const matchedERC20Log = logs
      .map(decodeERC20TransferLog)
      .find((log: any) =>
        log &&
        log.tokenAddress.toLowerCase() === lowerEthToken &&
        log.amount === stratoAmount &&
        log.to.toLowerCase() === config.safe.address?.toLowerCase()
      );

    if (isETHTransfer || matchedERC20Log) {
      console.log(`✅ Transaction ${txHash} validation successful`);
      console.log(`  - Expected amount: ${stratoAmount}`);
      console.log(`  - Expected token: ${ethTokenAddress}`);
      return { isValid: true };
    } else {
      console.warn(`❌ Transaction ${txHash} validation failed`);
      console.log(`  - Expected amount: ${stratoAmount}`);
      console.log(`  - Expected token: ${ethTokenAddress}`);
      return { 
        isValid: false, 
        error: 'Transaction details do not match expected values' 
      };
    }
  } catch (error: any) {
    console.error(`Error validating transaction ${txHash}:`, error.message);
    return { isValid: false, error: error.message };
  }
};

// ERC-20 Transfer event decoder
const decodeERC20TransferLog = (log: any) => {
  try {
    if (log.topics[0] !== TRANSFER_EVENT_SIG) return null;

    const from = ethers.getAddress("0x" + log.topics[1].slice(26));
    const to = ethers.getAddress("0x" + log.topics[2].slice(26));
    const amount = BigInt(log.data).toString();

    return { from, to, amount, tokenAddress: log.address };
  } catch (e) {
    console.error("Failed to decode log:", e);
    return null;
  }
};

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

  // Validate transaction with Alchemy before proceeding
  const validation = await validateTransactionWithAlchemy(
    ethHash,
    tokenAddress,
    amount,
  );

  if (!validation.isValid) {
    throw new Error(`Transaction validation failed: ${validation.error}`);
  }

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

export const confirmBridgeinSafePolling = async (txList: any[]) => {
  if (!config.safe?.address) return;

  const txBatch = txList.map((tx) => tx.result.transactionHash);
  console.log("txBatch....", txBatch);

  const depositStatus = await fetchDepositInitiatedTransactions(txBatch);

  console.log("depositStatus....", depositStatus);

  // ⚠️ TEMPORARY FIX: Filter out deposits with invalid token addresses from previous testnet deployment
  const INVALID_TOKEN_ADDRESSES = [
    "581ee622fb866f3c2076d4260824ce681b15b715", // Old incorrect ETHST address
    "500fb797b0be4ce0edf070a9b17bae56d22a2131", // Old incorrect USDCST address
  ];
  
  const validDeposits = depositStatus.filter((deposit: any) => {
    const tokenAddress = deposit.token.toLowerCase().replace("0x", "");
    const isInvalid = INVALID_TOKEN_ADDRESSES.includes(tokenAddress);
    
    if (isInvalid) {
      console.warn(`Skipping deposit with invalid token address: ${deposit.txHash} (token: ${tokenAddress})`);
    }
    
    return !isInvalid;
  });

  console.log("validDeposits after filtering....", validDeposits);

  if (validDeposits.length === 0) {
    console.log("No valid deposits to process");
    return;
  }

  try {
    const bridgeContract = new BridgeContractCall();
    const result = await bridgeContract.batchConfirmDeposits({
      deposits: validDeposits,
    });

    console.log("batchConfirmDeposits result:", result);

    if (result && result.status === "Success") {
      console.log("✅ Bridge deposits confirmed successfully, minting vouchers...");
      
      try {
        await mintVouchersForDeposits(validDeposits);
      } catch (voucherError) {
        console.error("Failed to mint vouchers (bridge deposits still succeeded):", voucherError);
      }
    } else {
      console.error("Bridge deposits failed:", result?.status || "Unknown error");
    }
  } catch (error) {
    console.error("Error in BatchconfirmDeposit for tx:", error);
  }
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

  // ⚠️ TEMPORARY FIX: Skip deposits with invalid token addresses from previous testnet deployment
  const INVALID_TOKEN_ADDRESSES = [
    "581ee622fb866f3c2076d4260824ce681b15b715", // Old incorrect ETHST address
    "500fb797b0be4ce0edf070a9b17bae56d22a2131", // Old incorrect USDCST address
  ];
  
  const tokenAddress = depositStatus.token.toLowerCase().replace("0x", "");
  const isInvalidToken = INVALID_TOKEN_ADDRESSES.includes(tokenAddress);
  
  if (isInvalidToken) {
    console.warn(`Skipping single deposit with invalid token address: ${depositStatus.txHash} (token: ${tokenAddress})`);
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

export const confirmBridgeOutSafePolling = async (txs: string[]) => {
  console.log("confirmBridgeOutSafePolling ", txs);
  const bridgeContract = new BridgeContractCall();
  await bridgeContract.batchConfirmWithdrawals({
    txHashes: txs,
  });
};

export const userDepositStatus = async (
  status: string,
  limit?: number,
  orderBy?: string,
  orderDirection?: string,
  pageNo?: string,
  userAddress?: string
) => {
  return await fetchDepositInitiatedStatus(
    status,
    limit,
    orderBy,
    orderDirection,
    pageNo,
    userAddress
  );
};

export const userWithdrawalStatus = async (
  status: string,
  limit?: number,
  orderBy?: string,
  orderDirection?: string,
  pageNo?: string,
  userAddress?: string
) => {
  return await fetchWithdrawalInitiatedStatus(
    status,
    limit,
    orderBy,
    orderDirection,
    pageNo,
    userAddress
  );
};

export const getBridgeInTokens = async () => {
  const bridgeInTokens = showTestnet ? TESTNET_ETH_TOKENS : MAINNET_ETH_TOKENS;

  const enrichedTokens = bridgeInTokens.map((token) => {
    const { exchangeTokenName, exchangeTokenSymbol } =
      getExchangeTokenInfoBridgeIn(token.tokenAddress, showTestnet);
    return {
      ...token,
      exchangeTokenName,
      exchangeTokenSymbol,
    };
  });

  return { bridgeInTokens: enrichedTokens };
};

export const getBridgeOutTokens = async () => {
  const bridgeOutTokens = showTestnet
    ? TESTNET_STRATO_TOKENS
    : MAINNET_STRATO_TOKENS;

  const enrichedTokens = bridgeOutTokens.map((token) => {
    const { exchangeTokenName, exchangeTokenSymbol } =
      getExchangeTokenInfoBridgeOut(token.tokenAddress, showTestnet);
    return {
      ...token,
      exchangeTokenName,
      exchangeTokenSymbol,
    };
  });

  return { bridgeOutTokens: enrichedTokens };
};
