import { config } from "../config";
import { ethers } from "ethers";
import axios from "axios";
import BridgeContractCall from "../utils/bridgeContractCall";

// Ethereum contract ABI for deposit events
const ETHEREUM_CONTRACT_ABI = [
  "event Deposit(address indexed from, address indexed token, uint256 amount, bytes32 indexed depositId)",
  "function getDeposits(uint256 fromBlock, uint256 toBlock) external view returns (tuple(address from, address token, uint256 amount, bytes32 depositId)[])"
];

interface DepositEvent {
  from: string;
  token: string;
  amount: string;
  depositId: string;
  blockNumber: number;
  transactionHash: string;
}

class EthereumContractPolling {
  private provider: ethers.JsonRpcProvider;
  private contract: ethers.Contract;
  private bridgeContract: BridgeContractCall;
  private lastProcessedBlock: number;
  private isPolling: boolean = false;

  constructor() {
    // Initialize Ethereum provider
    const ethereumRpcUrl = process.env.ETHEREUM_RPC_URL || config.ethereum.rpcUrl;
    if (!ethereumRpcUrl) {
      throw new Error("ETHEREUM_RPC_URL is not configured");
    }

    this.provider = new ethers.JsonRpcProvider(ethereumRpcUrl);
    
    // Initialize contract
    const contractAddress = process.env.ETHEREUM_CONTRACT_ADDRESS;
    if (!contractAddress) {
      throw new Error("ETHEREUM_CONTRACT_ADDRESS is not configured");
    }

    this.contract = new ethers.Contract(contractAddress, ETHEREUM_CONTRACT_ABI, this.provider);
    this.bridgeContract = new BridgeContractCall();
    
    // Get last processed block from environment or start from current block
    this.lastProcessedBlock = parseInt(process.env.LAST_PROCESSED_BLOCK || "0");
  }

  /**
   * Initialize the last processed block
   */
  async initializeLastProcessedBlock() {
    if (this.lastProcessedBlock === 0) {
      this.lastProcessedBlock = await this.provider.getBlockNumber();
    }
  }

  /**
   * Start polling for new deposit events
   */
  async startPolling(intervalMs: number) {
    if (this.isPolling) {
      console.log("Ethereum contract polling is already running");
      return;
    }

    // Initialize last processed block
    await this.initializeLastProcessedBlock();

    this.isPolling = true;
    console.log("🚀 Starting Ethereum contract polling...");

    while (this.isPolling) {
      try {
        await this.pollForNewDeposits();
        await this.sleep(intervalMs);
      } catch (error) {
        console.error("❌ Error in Ethereum contract polling:", error);
        await this.sleep(intervalMs);
      }
    }
  }

  /**
   * Stop polling
   */
  stopPolling() {
    this.isPolling = false;
    console.log("🛑 Stopped Ethereum contract polling");
  }

  /**
   * Poll for new deposit events
   */
  private async pollForNewDeposits() {
    try {
      const currentBlock = await this.provider.getBlockNumber();
      
      if (currentBlock <= this.lastProcessedBlock) {
        return; // No new blocks to process
      }

      console.log(`📡 Polling blocks ${this.lastProcessedBlock + 1} to ${currentBlock}`);

      // Get deposit events from the contract
      const depositEvents = await this.getDepositEvents(
        this.lastProcessedBlock + 1,
        currentBlock
      );

      if (depositEvents.length > 0) {
        console.log(`💰 Found ${depositEvents.length} new deposit events`);
        
        // Store deposit data
        await this.storeDepositData(depositEvents);
        
        // Step 1: Extract txHashes
        const txHashes = depositEvents.map(({ transactionHash }: { transactionHash: string }) => transactionHash);
        
        // Step 2: Batch call to get receipts
        const batch = txHashes.map((hash, i) => ({
          jsonrpc: '2.0',
          id: i,
          method: 'eth_getTransactionReceipt',
          params: [hash],
        }));

        const ethereumRpcUrl = process.env.ETHEREUM_RPC_URL || config.ethereum.rpcUrl;
        if (!ethereumRpcUrl) {
          throw new Error("ETHEREUM_RPC_URL is not configured");
        }
        const { data: batchResponses } = await axios.post(ethereumRpcUrl, batch);

        // Step 3: Extract valid transactionHashes from receipts
        const completedTxHashes = batchResponses.filter((res: any) => res?.result?.status === "0x1");

        if (!completedTxHashes.length) {
          console.log("⚠️ No completed transactions found");
          return;
        }

        console.log(`✅ Found ${completedTxHashes.length} completed transactions`);

        // Call confirmation function with completed transactions
        await this.confirmBridgeInSafePolling(completedTxHashes);
        
        // Update last processed block
        this.lastProcessedBlock = currentBlock;
        
        // Save last processed block to environment or database
        process.env.LAST_PROCESSED_BLOCK = currentBlock.toString();
      }

    } catch (error) {
      console.error("❌ Error polling for deposits:", error);
      throw error;
    }
  }

  /**
   * Get deposit events from the Ethereum contract
   */
  private async getDepositEvents(fromBlock: number, toBlock: number): Promise<DepositEvent[]> {
    try {
      // Method 1: Query events using ethers
      const filter = this.contract.filters.Deposit();
      const events = await this.contract.queryFilter(filter, fromBlock, toBlock);
      
      const depositEvents: DepositEvent[] = events.map(event => {
        // Type guard to check if event has args
        if ('args' in event && event.args) {
          return {
            from: event.args[0] || "",
            token: event.args[1] || "",
            amount: event.args[2]?.toString() || "0",
            depositId: event.args[3] || "",
            blockNumber: event.blockNumber || 0,
            transactionHash: event.transactionHash || ""
          };
        }
        
        // Fallback for events without args
        return {
          from: "",
          token: "",
          amount: "0",
          depositId: "",
          blockNumber: event.blockNumber || 0,
          transactionHash: event.transactionHash || ""
        };
      });

      return depositEvents;

    } catch (error) {
      console.error("❌ Error getting deposit events:", error);
      
      // Fallback: Try calling the contract method directly
      try {
        const deposits = await this.contract.getDeposits(fromBlock, toBlock);
        
        return deposits.map((deposit: any, index: number) => ({
          from: deposit.from || "",
          token: deposit.token || "",
          amount: deposit.amount?.toString() || "0",
          depositId: deposit.depositId || ethers.keccak256(ethers.toUtf8Bytes(`${fromBlock}-${index}`)),
          blockNumber: fromBlock,
          transactionHash: `fallback-${fromBlock}-${index}`
        }));
      } catch (fallbackError) {
        console.error("❌ Fallback method also failed:", fallbackError);
        return [];
      }
    }
  }

  /**
   * Store deposit data (implement your storage logic here)
   */
  private async storeDepositData(deposits: DepositEvent[]) {
    try {
      console.log("💾 Storing deposit data...");
      
      // TODO: Implement your storage logic here
      // This could be:
      // - Database insertion
      // - File storage
      // - API call to another service
      // - In-memory storage
      
      for (const deposit of deposits) {
        console.log(`📝 Stored deposit: ${deposit.depositId} from ${deposit.from} amount ${deposit.amount}`);
        
        // Example storage implementation:
        // await this.database.insertDeposit({
        //   depositId: deposit.depositId,
        //   fromAddress: deposit.from,
        //   tokenAddress: deposit.token,
        //   amount: deposit.amount,
        //   blockNumber: deposit.blockNumber,
        //   transactionHash: deposit.transactionHash,
        //   status: 'pending_confirmation'
        // });
      }
      
      console.log(`✅ Successfully stored ${deposits.length} deposits`);
      
    } catch (error) {
      console.error("❌ Error storing deposit data:", error);
      throw error;
    }
  }

  /**
   * Call batchConfirmDeposits on the bridge contract
   */
  private async batchConfirmDeposits(deposits: DepositEvent[]) {
    try {
      console.log("🔄 Calling batchConfirmDeposits...");
      
      // Prepare the arguments for batchConfirmDeposits
      const depositArgs = deposits.map(deposit => ({
        depositId: deposit.depositId,
        fromAddress: deposit.from,
        tokenAddress: deposit.token,
        amount: deposit.amount,
        blockNumber: deposit.blockNumber,
        transactionHash: deposit.transactionHash
      }));

      // Call the bridge contract
      const result = await this.bridgeContract.batchConfirmDeposits(depositArgs);
      
      console.log(`✅ Successfully confirmed ${deposits.length} deposits:`, result);
      
    } catch (error) {
      console.error("❌ Error calling batchConfirmDeposits:", error);
      throw error;
    }
  }

  /**
   * Confirm bridge-in safe polling with completed transaction hashes
   */
  private async confirmBridgeInSafePolling(completedTxHashes: any[]) {
    try {
      console.log("🔄 Confirming bridge-in safe polling...");
      
      // Extract transaction hashes from the completed responses
      const txHashes = completedTxHashes.map((res: any) => res.id);
      
      console.log(`📝 Processing ${txHashes.length} completed transaction hashes:`, txHashes);
      
      // TODO: Implement your bridge-in confirmation logic here
      // This could be:
      // - Calling a bridge contract method
      // - Updating database status
      // - Sending notifications
      // - Calling external APIs
      
      // Example implementation:
      for (const txHash of txHashes) {
        console.log(`✅ Confirmed bridge-in for transaction: ${txHash}`);
        
        // Example: Update deposit status in database
        // await this.updateDepositStatus(txHash, 'confirmed');
        
        // Example: Call bridge contract confirmation
        // await this.bridgeContract.confirmBridgeIn({ txHash });
      }
      
      console.log(`✅ Successfully confirmed ${txHashes.length} bridge-in transactions`);
      
    } catch (error) {
      console.error("❌ Error confirming bridge-in safe polling:", error);
      throw error;
    }
  }

  /**
   * Utility function to sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Start Ethereum contract polling
 */
export const startEthereumContractPolling = async (intervalMs: number) => {
  try {
    const polling = new EthereumContractPolling();
    await polling.startPolling(intervalMs);
  } catch (error) {
    console.error("❌ Failed to start Ethereum contract polling:", error);
    throw error;
  }
};

export default EthereumContractPolling; 