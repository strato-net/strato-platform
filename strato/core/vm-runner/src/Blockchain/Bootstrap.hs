{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.Bootstrap where

import BlockApps.Logging
import Blockchain.BlockDB
import Blockchain.Data.AddressStateDB
import Blockchain.Data.Block
import Blockchain.Data.BlockDB
import Blockchain.Data.BlockHeader (number, currentValidators)
import Blockchain.Data.Extra
import Blockchain.Data.GenesisInfo hiding (stateRoot, number)
import qualified Blockchain.Data.GenesisInfo as GI
import qualified Blockchain.Data.TXOrigin as Origin
import Blockchain.DB.CodeDB
import Blockchain.DB.HashDB
import Blockchain.DB.SQLDB
import Blockchain.DB.StateDB (HasStateDB)
import qualified Blockchain.Database.MerklePatricia as MP
import qualified Blockchain.EthConf as UEC
import Blockchain.Model.WrappedBlock (OutputBlock(..))
import Blockchain.Model.SyncState
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
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Composable.Kafka
import Control.Monad.Trans.Reader (ReaderT, runReaderT, asks)
import Blockchain.Strato.RedisBlockDB (RedisConnection, withRedisBlockDB)
import Data.Foldable (for_, traverse_)
import qualified Data.Map as Map
import qualified Data.Map.Ordered as OMap
import Data.Maybe
import qualified Data.Sequence as S
import qualified Data.Text as T
import qualified Data.Text.Encoding as T
import Data.Traversable (for)
import Text.Format

-- | Transformer that provides read-only access to a map of AddressStates.
-- Used during genesis bootstrap to allow address-based imports in compilation.
newtype WithAddressStateMap m a = WithAddressStateMap 
  { unWithAddressStateMap :: ReaderT (Map.Map Ad.Address AddressState) m a }
  deriving (Functor, Applicative, Monad, MonadIO, MonadLogger)

instance MonadTrans WithAddressStateMap where
  lift = WithAddressStateMap . lift

instance {-# OVERLAPPING #-} Monad m => A.Selectable Ad.Address AddressState (WithAddressStateMap m) where
  select _ addr = WithAddressStateMap $ asks (Map.lookup addr)

instance (Keccak256 `A.Alters` DBCode) m => (Keccak256 `A.Alters` DBCode) (WithAddressStateMap m) where
  lookup p k = lift $ A.lookup p k
  insert p k v = lift $ A.insert p k v
  delete p k = lift $ A.delete p k

runWithAddressStateMap :: Map.Map Ad.Address AddressState -> WithAddressStateMap m a -> m a
runWithAddressStateMap addrMap action = runReaderT (unWithAddressStateMap action) addrMap

addrInfoToAddressState :: GI.AddressInfo -> AddressState
addrInfoToAddressState (GI.NonContract _ bal) = 
  blankAddressState { addressStateBalance = bal }
addrInfoToAddressState (GI.ContractNoStorage _ bal ch) = 
  blankAddressState { addressStateBalance = bal, addressStateCodeHash = ch }
addrInfoToAddressState (GI.SolidVMContractWithStorage _ bal ch _) = 
  blankAddressState { addressStateBalance = bal, addressStateCodeHash = ch }

populateStorageDBs ::
  ( MonadLogger m,
    HasSQLDB m,
    HasCodeDB m,
    HasStateDB m,
    HasHashDB m,
    (Ad.Address `A.Alters` AddressState) m
  ) =>
  GenesisInfo ->
  Block ->
  Maybe Word256 ->
  m ()
populateStorageDBs genesisInfo genesisBlock genesisChainId = do
  liftIO . UEC.runKafkaMConfigured "strato-init" $ do
    assertStateDiffTopicCreation
  kafkaEnv <- runKafkaVMEvents getKafkaEnv
  let pub sd vmes = do
        traverse_ commitSqlDiffs sd
        void . runKafkaMUsingEnv kafkaEnv $ produceVMEvents' vmes
  let sr = GI.stateRoot genesisInfo

  mSR <- A.lookup (A.Proxy @MP.StateRoot) (Nothing :: Maybe Word256)
  A.insert (A.Proxy @MP.StateRoot) (Nothing :: Maybe Word256) sr

  let addresses = GI.addrInfoAddress <$> GI.addressInfo genesisInfo
      events' = GI.events genesisInfo
      delegatecalls' = GI.delegatecalls genesisInfo

  let addressStateMap = Map.fromList 
        [(GI.addrInfoAddress ai, addrInfoToAddressState ai) | ai <- GI.addressInfo genesisInfo]

  ccas <- runWithAddressStateMap addressStateMap $
    fmap catMaybes . for (GI.codeInfo genesisInfo) $ \(GI.CodeInfo src mName) -> for mName $ \_ -> do
      let srcHash = hash $ T.encodeUtf8 src
      cc <- codeCollectionFromHash False True srcHash
      pure $ CodeCollectionAdded (() <$ cc) "BlockApps"

  pub Nothing ccas

  for_ addresses $ \address -> do
    addressState <- A.lookupWithDefault (A.Proxy @AddressState) address

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

  liftIO $ bootstrapIndexer OutputBlock
    { obOrigin = Origin.Direct,
      obBlockData = blockBlockData genesisBlock,
      obReceiptTransactions = [],  -- genesis block has no transactions
      obBlockUncles = blockBlockUncles genesisBlock
    }

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

seedDatabases ::
  ( HasSQLDB m,
    Mod.Accessible RedisConnection m,
    MonadLogger m
  ) =>
  Block ->
  m ()
seedDatabases genesisBlock = do
  let validators' = currentValidators $ blockHeader genesisBlock
      genesisHash' = blockHash genesisBlock
  $logInfoS "bootstrap" $ T.pack $ "Genesis hash: " ++ format genesisHash'
  $logInfoS "bootstrap" $ T.pack $ "Validators: " ++ show (length validators')

  putGenesisHash genesisHash'
  void $ putBlocks [genesisBlock] False

  _ <- withRedisBlockDB $ putBestSequencedBlockInfo $ BestSequencedBlock genesisHash' 0 validators'

  void . withRedisBlockDB $ do
    forceBestBlockInfo
      genesisHash'
      (number . blockBlockData $ genesisBlock)

  void . withRedisBlockDB $
    putBlock OutputBlock
    { obOrigin = Origin.Direct,
      obBlockData = blockBlockData genesisBlock,
      obReceiptTransactions = [],
      obBlockUncles = []
    }

  $logInfoS "bootstrap" "Database seeding complete"
