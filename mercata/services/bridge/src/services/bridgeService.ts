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

const showTestnet = process.env.SHOW_TESTNET === "true";

const checkDepositStatus = async (txHash: string): Promise<any | null> => {
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

// Comment out the existing batch processing function
/*
export const confirmBridgeinSafePolling = async (txList: any[]) => {
  if (!config.safe?.address) return;

  const txBatch = txList.map((tx) => tx.result.transactionHash);

  const depositStatus = await fetchDepositInitiatedTransactions(txBatch);

  // ⚠️ TEMPORARY FIX: Filter out deposits with invalid token addresses from previous testnet deployment
  const INVALID_TOKEN_ADDRESSES = [
    "581ee622fb866f3c2076d4260824ce681b15b715", // Old incorrect ETHST address
    "500fb797b0be4ce0edf070a9b17bae56d22a2131", // Old incorrect USDCST address
  ];
  
  const validDeposits = depositStatus.filter((deposit: any) => {
    const tokenAddress = deposit.token.toLowerCase().replace("0x", ""),
    const isInvalid = INVALID_TOKEN_ADDRESSES.includes(tokenAddress);
    
    if (isInvalid) {
    }
    
    return !isInvalid;
  });

  if (validDeposits.length === 0) {
    return;
  }

  try {
    const bridgeContract = new BridgeContractCall();
    const result = await bridgeContract.batchConfirmDeposits({
      deposits: validDeposits,
    });

    if (result && result.status === "Success") {
      
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
*/

// New function that processes deposits one by one and calls depositCompleted contract method
export const confirmBridgeinSafePolling = async (txList: any[]) => {
  if (!config.safe?.address) return;

  // Process each transaction individually instead of in batch
  for (const tx of txList) {
    try {
      const txHash = tx.result?.transactionHash || tx;
      
      // Get deposit status for this specific transaction
      const depositStatus = await fetchDepositInitiatedTransactions([txHash]);
      
      if (!depositStatus || depositStatus.length === 0) {
        console.log(`⚠️ No deposit status found for transaction: ${txHash}`);
        continue;
      }

      const deposit = depositStatus[0]; // Get the first (and only) deposit

      // ⚠️ TEMPORARY FIX: Filter out deposits with invalid token addresses from previous testnet deployment
      const INVALID_TOKEN_ADDRESSES = [
        "581ee622fb866f3c2076d4260824ce681b15b715", // Old incorrect ETHST address
        "500fb797b0be4ce0edf070a9b17bae56d22a2131", // Old incorrect USDCST address
      ];
      
      const tokenAddress = deposit.token.toLowerCase().replace("0x", "");
      const isInvalid = INVALID_TOKEN_ADDRESSES.includes(tokenAddress);
      
      if (isInvalid) {
        console.log(`⚠️ Skipping invalid token address: ${tokenAddress}`);
        continue;
      }

      try {
        const bridgeContract = new BridgeContractCall();
        
        // Call depositCompleted contract method for single deposit
        const result = await bridgeContract.depositCompleted({
          txHash: deposit.txHash.toString().replace("0x", ""),
          token: deposit.token.toLowerCase().replace("0x", ""),
          to: config.safe.address.toLowerCase().replace("0x", ""),
          amount: deposit.amount.toString(),
          mercataUser: deposit.mercataUser.toLowerCase().replace("0x", ""),
        });

        if (result && result.status === "Success") {
          console.log(`✅ Successfully completed deposit for transaction: ${txHash}`);
          
          try {
            // Mint vouchers for this single deposit
            await mintVouchersForDeposits([deposit]);
          } catch (voucherError) {
            console.error(`Failed to mint vouchers for transaction ${txHash} (deposit still succeeded):`, voucherError);
          }
        } else {
          console.error(`❌ Deposit completion failed for transaction ${txHash}:`, result?.status || "Unknown error");
        }
        
      } catch (error) {
        console.error(`❌ Error completing deposit for transaction ${txHash}:`, error);
      }
      
    } catch (err: any) {
      console.error(`❌ Failed to process transaction in confirmBridgeinSafePolling:`, err);
    }
  }
};

// get the possible data from alchemy and verify in this call
export const confirmBridgeIn = async (tx: any) => {
  if (!config.safe?.address) {
    return null;
  }

  // Check deposit status from Mercata endpoint
  const depositStatus = await checkDepositStatus(tx.hash);

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
    return null;
  }

  try {
    const bridgeContract = new BridgeContractCall();

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
};

// Comment out the existing batch processing function
/*
export const confirmBridgeOutSafePolling = async (txs: string[]) => {
    if (!txs || txs.length === 0) {
    return;
  }
  
  const bridgeContract = new BridgeContractCall();
  await bridgeContract.batchConfirmWithdrawals({
    txHashes: txs,
  });
};
*/

// New function that processes withdrawal confirmations one by one
export const confirmBridgeOutSafePolling = async (txs: string[]) => {
  if (!txs || txs.length === 0) {
    return;
  }
  
  // Process each withdrawal transaction individually instead of in batch
  for (const txHash of txs) {
    try {
      console.log(`🔄 Processing withdrawal confirmation for transaction: ${txHash}`);
      
      const bridgeContract = new BridgeContractCall();
      
      // Call confirmWithdrawal contract method for single withdrawal
      const result = await bridgeContract.finaliseWithdrawal({
        txHash: txHash,
      });

      if (result && result.status === "Success") {
        console.log(`✅ Successfully confirmed withdrawal for transaction: ${txHash}`);
      } else {
        console.error(`❌ Withdrawal confirmation failed for transaction ${txHash}:`, result?.status || "Unknown error");
      }
      
    } catch (error) {
      console.error(`❌ Error confirming withdrawal for transaction ${txHash}:`, error);
    }
  }
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
