{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE NumericUnderscores #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.SeedDatabases
  ( mkDatabases
  ) where

import BlockApps.Logging
import Blockchain.BlockDB
import qualified Blockchain.Data.DataDefs as DataDefs
import Blockchain.DB.CodeDB
import Blockchain.DB.HashDB
import Blockchain.DB.SQLDB
import Blockchain.DB.StateDB (HasStateDB, getStateRoot, setStateDBStateRoot)
import Blockchain.Data.AddressStateDB
import Blockchain.Data.Block
import Blockchain.Data.BlockHeader
import Blockchain.Data.BlockDB
import Blockchain.Data.Extra
import Blockchain.Data.GenesisBlock
import Blockchain.Data.GenesisInfo hiding (stateRoot, number)
import qualified Blockchain.Data.GenesisInfo as GI
import qualified Blockchain.Data.TXOrigin as Origin
import Blockchain.Init.Monad (runSetupDBM)
import qualified Blockchain.Database.MerklePatricia as MP
import qualified Blockchain.EthConf as UEC
import qualified Blockchain.EthConf.Model as EC
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
import Blockchain.Strato.StateDiff hiding (StateDiff (blockHash, chainId, stateRoot))
import qualified Blockchain.Strato.StateDiff as StateDiff (StateDiff (blockHash, chainId, stateRoot))
import Blockchain.Strato.StateDiff.Database
import Blockchain.Strato.StateDiff.Kafka (assertStateDiffTopicCreation)
import qualified Blockchain.Stream.Action as A
import Blockchain.Stream.VMEvent
import Blockchain.SyncDB
import Conduit
import Control.Monad
import Control.Monad.Change.Alter (Selectable)
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Composable.Kafka
import Control.Monad.Composable.Redis
import Control.Monad.Composable.SQL
import Control.Monad.Trans.Reader
import Data.Foldable (for_, traverse_)
import qualified Data.Map as Map
import qualified Data.Map.Ordered as OMap
import Data.Maybe
import qualified Data.Sequence as S
import Data.String
import qualified Data.Text as T
import qualified Data.Text.Encoding as T
import Data.Traversable (for)
import Database.Persist.Postgresql
import Text.Format
import qualified Text.Colors as CL
import UnliftIO.Exception (catch, SomeException)

-- | Seed databases (Redis, Kafka, PostgreSQL) with genesis block data.
-- Called by seed-genesis after docker containers are running.
-- Reads genesis.json which must already exist (created by strato-setup).
mkDatabases :: (MonadLoggerIO m, MonadUnliftIO m, MonadFail m, HasKafka m) =>
               m ()
mkDatabases = do
  -- Read ethconf from file (created by strato-setup)
  let ethconf = UEC.ethConf

  let pgconf = EC.sqlConfig ethconf
      rawConn = EC.postgreSQLConnectionString pgconf {EC.database = ""}
      localConn = EC.postgreSQLConnectionString pgconf
      db = EC.database pgconf
  $logInfoS "seed-genesis" . T.pack $ CL.yellow $ "Creating database: " ++ db
  $logInfoLS "seed-genesis" rawConn
  let query = T.pack $ "CREATE DATABASE " ++ show db ++ ";"

  catch
    (withPostgresqlConn rawConn (runReaderT (rawExecute query [])))
    (\(_ :: SomeException) -> $logInfoS "seed-genesis" "Database already exists, skipping")

  withPostgresqlConn localConn $
    runReaderT $ do
      $logInfoS "seed-genesis" . T.pack $ CL.yellow ">>>> Migrating eth"
      $logInfoLS "seed-genesis" localConn
      runMigration DataDefs.migrateAll
      $logInfoS "seed-genesis" . T.pack $ CL.yellow ">>>> Indexing eth"
      runMigration DataDefs.indexAll

  let topics :: [String] =
        [
        "statediff",
        "seq_vm_events",
        "seq_p2p_events",
        "unseqevents",
        "jsonrpcresponse",
        "indexevents",
        "vmevents",
        "solidvmevents"
        ]

  forM_ topics $ createTopic . fromString

  runResourceT . runSetupDBM . runRedisM UEC.lookupRedisBlockDBConfig . runSQLM $ do
    $logInfoS "seed-genesis" "Seeding databases from genesis.json"
    seedDatabases
    $logInfoS "seed-genesis" "Database seeding complete"

-- | Seed databases (Redis, Kafka, PostgreSQL) with genesis block data.
-- This is called by seed-genesis (after docker containers are running).
-- Reads genesis.json which must already exist with correct stateRoot and validators.
seedDatabases ::
  ( HasCodeDB m,
    HasHashDB m,
    HasRedis m,
    HasSQLDB m,
    HasStateDB m,
    MonadLogger m,
    Selectable Ad.Address AddressState m
  ) =>
  m ()
seedDatabases = do
  $logInfoS "seed-genesis" "Reading genesis.json"
  genesisInfo <- liftIO GI.getGenesisInfo
  let genesisBlock = genesisInfoToBlock genesisInfo
      validators' = GI.validators genesisInfo
  $logInfoS "seed-genesis" $ T.pack $ "Genesis hash: " ++ format (blockHash genesisBlock)
  $logInfoS "seed-genesis" $ T.pack $ "Validators: " ++ show (length validators')

  obGB <- liftIO $ bootstrapSequencer genesisBlock
  putGenesisHash $ blockHash genesisBlock
  void $ putBlocks [genesisBlock] False

  _ <- execRedis $ putBestSequencedBlockInfo $ BestSequencedBlock (blockHash genesisBlock) 0 validators'

  let genesisChainId = Nothing
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

  liftIO $ bootstrapIndexer obGB
  setStateDBStateRoot genesisChainId (GI.stateRoot genesisInfo)
  populateStorageDBs genesisInfo genesisBlock genesisChainId
  $logInfoS "seed-genesis" "Database seeding complete"

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
  sr <- getStateRoot genesisChainId

  liftIO . UEC.runKafkaMConfigured "strato-init" $ do
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

  let addresses = GI.addrInfoAddress <$> GI.addressInfo genesisInfo
      events' = GI.events genesisInfo
      delegatecalls' = GI.delegatecalls genesisInfo

  ccas <- fmap catMaybes . for (GI.codeInfo genesisInfo) $ \(GI.CodeInfo src mName) -> for mName $ \_ -> do
    let srcHash = hash $ T.encodeUtf8 src
    cc <- codeCollectionFromHash False True srcHash
    pure $ CodeCollectionAdded (() <$ cc) "BlockApps"

  pub Nothing ccas

  for_ addresses $ \address -> do
    addressState <- A.selectWithDefault (A.Proxy @AddressState) address

    $logInfoS "initgen" $ T.pack $
      "##################### writing to DBs: " ++ format address

    let addrStateMap = Map.fromList [(address, addressState)]
        squashMap f = mapM (uncurry f) . Map.toList

    accountDiffs <- mapM eventualAccountState addrStateMap
    let addressEvents = Map.findWithDefault S.empty address  events'
        dc = case addressStateCodeHash addressState of
          ExternallyOwned{} -> S.empty
          SolidVMCode name _ -> S.singleton $ A.Delegatecall
            { A._delegatecallStorageAddress = address
            , A._delegatecallCodeAddress = address
            , A._delegatecallOrganization = Just "BlockApps"
            , A._delegatecallContractName = T.pack name
            }
    let addressDelegatecalls = dc S.>< Map.findWithDefault S.empty address delegatecalls'
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
    toAction addressEvents delegatecalls'' a d = do
      pure . NewAction $ A.Action
            { A._blockHash = blockHeaderHash $ blockHeader genesisBlock,
              A._blockTimestamp =
                blockHeaderTimestamp $ blockHeader genesisBlock,
              A._blockNumber =
                blockHeaderBlockNumber $ blockHeader genesisBlock,
              A._transactionSender = Ad.Address 0,
              A._actionData =
                OMap.singleton (a, A.ActionData storageDiff),
              A._newCodeCollections = OMap.empty,
              A._events = addressEvents,
              A._delegatecalls = delegatecalls''
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
    UEC.runKafkaMConfigured clientId $
    IdxKafka.produceIndexEvents [IdxModel.RanBlock obGB]

  print res
  putStrLn "bootstrapIndex genesis seed successful!"
