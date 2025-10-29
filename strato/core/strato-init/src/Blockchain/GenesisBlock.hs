{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.GenesisBlock
  ( initializeGenesisBlock
  , populateStorageDBs'
  )
where

import BlockApps.Logging
import Blockchain.BlockDB
import Blockchain.DB.CodeDB
import Blockchain.DB.HashDB
import qualified Blockchain.DB.MemAddressStateDB as Mem
import Blockchain.DB.SQLDB
import Blockchain.DB.StateDB
import Blockchain.DB.StorageDB
import Blockchain.Data.AddressStateDB
import Blockchain.Data.Block
import Blockchain.Data.BlockHeader
import Blockchain.Data.BlockDB
import Blockchain.Data.Extra
import Blockchain.Data.GenesisBlock
import Blockchain.Data.GenesisInfo (GenesisInfo)
import qualified Blockchain.Data.GenesisInfo as GI
import qualified Blockchain.Data.TXOrigin as Origin
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.EthConf
import Blockchain.Generation (readValidatorsFromGenesisInfo)
import Blockchain.Model.WrappedBlock (OutputBlock(..))
import Blockchain.Model.SyncState
import Blockchain.Sequencer.Bootstrap (bootstrapSequencer)
import Blockchain.SolidVM.CodeCollectionDB
import qualified Blockchain.Strato.Indexer.ApiIndexer as ApiIndexer
import qualified Blockchain.Strato.Indexer.Kafka as IdxKafka
import qualified Blockchain.Strato.Indexer.Model as IdxModel
import Blockchain.Strato.Model.Event
import qualified Blockchain.Strato.Model.Address as Ad
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Validator
import Blockchain.Strato.StateDiff hiding (StateDiff (blockHash, chainId, stateRoot))
import qualified Blockchain.Strato.StateDiff as StateDiff (StateDiff (blockHash, chainId, stateRoot))
import Blockchain.Strato.StateDiff.Database
import Blockchain.Strato.StateDiff.Kafka (assertStateDiffTopicCreation)
import qualified Blockchain.Stream.Action as A
import Blockchain.Stream.VMEvent
import Blockchain.SyncDB
import Control.Monad
import Control.Monad.Change.Alter (Alters, Selectable)
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Composable.Kafka (getKafkaEnv, runKafkaMUsingEnv)
import Control.Monad.Composable.Redis
import Control.Monad.IO.Class
import Data.Foldable (for_, traverse_)
import qualified Data.Map as Map
import qualified Data.Map.Ordered as OMap
import Data.Maybe
import qualified Data.Sequence as S
import qualified Data.Text as T
import qualified Data.Text.Encoding as T
import Data.Traversable (for)
import Text.Format

getGenesisBlockAndPopulateInitialMPs ::
  ( MonadIO m,
    MonadLogger m,
    HasCodeDB m,
    HasHashDB m,
    Mem.HasMemAddressStateDB m,
    HasStateDB m,
    HasStorageDB m,
    HasMemStorageDB m,
    (Ad.Address `Alters` AddressState) m
  ) =>
  m ([Validator], GenesisInfo, Block)
getGenesisBlockAndPopulateInitialMPs = do
  genesisInfo <- GI.getGenesisInfo
  let validators = readValidatorsFromGenesisInfo genesisInfo

  (validators, genesisInfo,) <$> genesisInfoToGenesisBlock validators genesisInfo

initializeGenesisBlock ::
  ( HasCodeDB m,
    HasHashDB m,
    Mem.HasMemAddressStateDB m,
    HasRedis m,
    HasSQLDB m,
    HasStateDB m,
    HasStorageDB m,
    HasMemStorageDB m,
    MonadLogger m,
    (Ad.Address `Alters` AddressState) m,
    Selectable Ad.Address AddressState m
  ) =>
  m ()
initializeGenesisBlock = do
  $logInfoS "initgen" "Begin of initgen"
  (validators, genesisInfo, genesisBlock) <- getGenesisBlockAndPopulateInitialMPs
  obGB <- liftIO $ bootstrapSequencer genesisBlock
  putGenesisHash $ blockHash genesisBlock
  $logInfoS "initgen" "Initial merkle patricia tries successfully created"
  void $ putBlocks [genesisBlock] False
  $logInfoS "initgen" "Genesis Block put"
  $logInfoS "initgen" "State diff has been generated"

  _ <- execRedis $ putBestSequencedBlockInfo $ BestSequencedBlock (blockHash genesisBlock) 0 validators

  let genesisChainId = Nothing -- TODO: It's possible that we would call this function for private chain creation
  $logInfoS "initgen" "Beginning to write to redis"
  void . execRedis $ do
    forceBestBlockInfo
      (blockHash genesisBlock)
      (number . blockBlockData $ genesisBlock)

  void . execRedis $
    putBlock OutputBlock
    { obOrigin = Origin.Direct,
      obBlockData = blockBlockData genesisBlock,
      obReceiptTransactions = [],
      obBlockUncles = []
    }

  $logInfoS "initgen" "best block info inserted"
  liftIO $ bootstrapIndexer obGB
  $logInfoS "initgen" "indexer has been bootstrapped"
  populateStorageDBs genesisInfo genesisBlock genesisChainId
  $logInfoS "initgen" "populateStorageDBs is done"


  -- | Populate storage databases with genesis block state and generate
  -- corresponding events
  --
  -- This function performs several critical initialization tasks for the
  -- genesis block:
  --
  -- 1. **State Root Management**: Retrieves current state root and temporarily
  --    replaces it during processing to ensure consistent state handling
  --
  -- 2. **Kafka Topic Setup**: Ensures StateDiff topic exists in Kafka for event
  -- streaming
  --
  -- 3. **Address Processing**: Iterates through all genesis account addresses
  -- and:
  --
  --    - Fetches full address state from the state database
  --    - Applies special filtering for Vitu vehicle manager contract (0x7000...0000)
  --      to prevent performance issues with large arrays
  --
  -- 4. **State Diff Generation**: Creates SQL database diffs representing
  --    account creation events for the genesis block, including:
  --
  --    - Block metadata (chain ID, block number, block hash, state root)
  --    - Account state changes (all accounts are marked as "created")
  --
  -- 5. **VM Event Production**: Generates and publishes VM events to Kafka,
  -- including:
  --
  --    - Contract deployment events for SolidVM contracts
  --    - Action events with transaction metadata
  --    - Code collection information and storage diffs
  --    - Creator and origin address tracking
  --
  -- 6. **Contract Metadata Processing**: For SolidVM contracts, extracts and
  -- processes:
  --
  --    - Abstract parent contracts
  --    - Contract mappings and arrays
  --    - Source code and contract names from metadata
  --
  -- The function ensures that both the SQL database and Kafka event stream are
  -- properly initialized with the genesis block state, enabling proper
  -- blockchain operation.
populateStorageDBs ::
  ( MonadLogger m,
    HasSQLDB m,
    HasCodeDB m,
    HasStateDB m,
    HasHashDB m,
    Selectable Ad.Address AddressState m
  ) =>
  GenesisInfo ->
  Block ->
  Maybe Word256 ->
  m ()
populateStorageDBs genesisInfo genesisBlock genesisChainId = do
  -- Step 1: State Root Management - Retrieve current state root and temporarily replace it
  sr <- getStateRoot genesisChainId

  -- Step 2: Kafka Topic Setup - Ensure StateDiff topic exists for event streaming
  liftIO . runKafkaMConfigured "strato-init" $ do
    assertStateDiffTopicCreation
  kafkaEnv <- runKafkaVMEvents getKafkaEnv
  let pub sd vmes = do
        traverse_ commitSqlDiffs sd
        void . runKafkaMUsingEnv kafkaEnv $ produceVMEvents' vmes
  populateStorageDBs' genesisInfo genesisBlock genesisChainId sr pub

populateStorageDBs' ::
  ( MonadIO m,
    MonadLogger m,
    HasCodeDB m,
    HasStateDB m,
    HasHashDB m,
    Selectable Ad.Address AddressState m
  ) =>
  GenesisInfo ->
  Block ->
  Maybe Word256 ->
  MP.StateRoot ->
  (Maybe StateDiff.StateDiff -> [VMEvent] -> m ()) ->
  m ()
populateStorageDBs' genesisInfo genesisBlock genesisChainId sr pub = do
  mSR <- A.lookup (A.Proxy @MP.StateRoot) (Nothing :: Maybe Word256)
  A.insert (A.Proxy @MP.StateRoot) (Nothing :: Maybe Word256) sr

  -- Step 3: Address Processing - Iterate through all genesis account addresses
  let addresses = GI.addrInfoAddress <$> GI.addressInfo genesisInfo
      events = GI.events genesisInfo
      delegatecalls = GI.delegatecalls genesisInfo

  ccas <- fmap catMaybes . for (GI.codeInfo genesisInfo) $ \(GI.CodeInfo src mName) -> for mName $ \_ -> do
    let srcHash = hash $ T.encodeUtf8 src
    cc <- codeCollectionFromHash False True srcHash
    pure $ CodeCollectionAdded (() <$ cc) "BlockApps"

  pub Nothing ccas

  for_ addresses $ \address -> do
    -- Fetch full address state from the state database
    addressState <- A.selectWithDefault (A.Proxy @AddressState) address

    $logInfoS "initgen" $ T.pack $
      "##################### writing to DBs: " ++ format address

    let addrStateMap = Map.fromList [(address, addressState)]
        squashMap f = mapM (uncurry f) . Map.toList

    -- Step 4: State Diff Generation - Create SQL database diffs for account creation
    accountDiffs <- mapM eventualAccountState addrStateMap
    -- Step 5: VM Event Production - Generate and publish VM events to Kafka
    let addressEvents = Map.findWithDefault S.empty address  events
    let addressDelegatecalls = Map.findWithDefault S.empty address delegatecalls
    vmEvents <- squashMap (toAction addressEvents addressDelegatecalls) accountDiffs
    pub (Just $ mkStateDiff accountDiffs) vmEvents

  for_ mSR $ A.insert (A.Proxy @MP.StateRoot) (Nothing :: Maybe Word256)

  where

    mkStateDiff ad =
      StateDiff
        { StateDiff.chainId = genesisChainId,
          blockNumber = 0,
          StateDiff.blockHash = blockHash genesisBlock,
          StateDiff.stateRoot =
            MP.StateRoot . blockHeaderStateRoot $ blockHeader genesisBlock,
          createdAccounts = ad,
          deletedAccounts = Map.empty,
          updatedAccounts = Map.empty
        }

    toAction ::
      MonadLogger m
      => S.Seq Event
      -> S.Seq A.Delegatecall
      -> Ad.Address
      -> AccountDiff 'Eventual
      -> m VMEvent
    toAction addressEvents delegatecalls a d = do
      pure . NewAction $ A.Action
            { A._blockHash = blockHeaderHash $ blockHeader genesisBlock,
              A._blockTimestamp =
                blockHeaderTimestamp $ blockHeader genesisBlock,
              A._blockNumber =
                blockHeaderBlockNumber $ blockHeader genesisBlock,
              A._transactionSender = Ad.Address 0,
              A._actionData =
                OMap.singleton (a, A.ActionData storageDiff),
              A._newCodeCollections = [],
              A._events = addressEvents,
              A._delegatecalls = delegatecalls
            }
      where

        fromDiff :: Diff a 'Eventual -> a
        fromDiff (Value v) = v

        storageDiff = case storage d of
          SolidVMDiff m -> A.SolidVMDiff $ Map.map fromDiff m
          EVMDiff _ -> error "evm state in genesis block isn't supported"

bootstrapIndexer :: OutputBlock -> IO ()
bootstrapIndexer obGB = do
  let clientId = fst ApiIndexer.kafkaClientIds
  putStrLn "About to bootstrap index events"
  res <-
    runKafkaMConfigured clientId $
    IdxKafka.produceIndexEvents [IdxModel.RanBlock obGB]

  print res
  putStrLn "bootstrapIndex genesis seed successful!"
