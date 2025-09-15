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
import BlockApps.X509.Certificate
import Blockchain.BlockDB
import Blockchain.CertificateDB
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
import Blockchain.Data.GenesisInfo
import Blockchain.Data.RLP
import qualified Blockchain.Data.TXOrigin as Origin
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.EthConf
import Blockchain.Generation
  ( readCertsFromGenesisInfo,
    readValidatorsFromGenesisInfo,
  )
import Blockchain.Model.WrappedBlock (OutputBlock(..))
import Blockchain.Model.SyncState
import Blockchain.Sequencer.Bootstrap (bootstrapSequencer)
import Blockchain.SolidVM.CodeCollectionDB
import Blockchain.SolidVM.SM
import qualified Blockchain.Strato.Indexer.ApiIndexer as ApiIndexer
import qualified Blockchain.Strato.Indexer.Kafka as IdxKafka
import qualified Blockchain.Strato.Indexer.Model as IdxModel
import Blockchain.Strato.Model.Event
import Blockchain.Strato.Model.Account
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
import Control.Lens ((^.), at)
import Control.Monad
import Control.Monad.Change.Alter (Alters, Selectable)
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Composable.Redis
import Control.Monad.IO.Class
import Data.Foldable (for_)
import qualified Data.Map as Map
import Data.Map.Strict (Map)
import qualified Data.Map.Ordered as OMap
import Data.Maybe
import qualified Data.Sequence as S
import Data.Text (Text)
import qualified Data.Text as T
import qualified Data.Text.Encoding as T
import SolidVM.Model.CodeCollection (emptyCodeCollection)
import SolidVM.Model.Storable
import qualified SolidVM.Model.CodeCollection as CC
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
    (Ad.Address `Alters` AddressState) m,
    HasRedis m
  ) =>
  m ([(Ad.Address, X509CertInfoState)], [Validator], GenesisInfo, ([(AccountInfo, CodeInfo)], Block))
getGenesisBlockAndPopulateInitialMPs = do
  genesisInfo <- getGenesisInfo
  let certs' = readCertsFromGenesisInfo genesisInfo
      validators = readValidatorsFromGenesisInfo genesisInfo

  -- Need to insert the X509 certificates INTO Redis
  void . execRedis $ insertRootCertificate
  $logInfoS "Redis/certInsertion" $ T.pack . format $ x509CertToCertInfoState rootCert

  extraCertInfoStates <-
    mapM
      ( \c -> do
          let c' = x509CertToCertInfoState c
              ua' = userAddress c'
          insertCert <- execRedis $ registerCertificate ua' c'
          case insertCert of
            Right _ -> $logInfoS "Redis/certInsertion" $ T.pack "Certificate insertion was successful"
            Left e -> $logInfoS "Redis/certInsertion" $ T.pack $ "Certificate insertion failed: " ++ show e
          pure (ua', c')
      )
      certs'

  (extraCertInfoStates, validators, genesisInfo,) <$> genesisInfoToGenesisBlock genesisInfo

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
  (extraCertInfoStates, validators, genesisInfo, (srcInfo, genesisBlock)) <- getGenesisBlockAndPopulateInitialMPs
  obGB <- liftIO $ bootstrapSequencer extraCertInfoStates genesisBlock
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
  let rewrite (_, CodeInfo src name) =
        ( hash $ T.encodeUtf8 src,
          Map.fromList $
            [("src", src)]
              ++ case name of
                Nothing -> []
                Just n -> [("name", n)]
        )
      metadatas = Map.fromList . map rewrite $ srcInfo
      findMetadata = flip Map.lookup metadatas
  populateStorageDBs findMetadata genesisInfo genesisBlock genesisChainId
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
    Selectable Ad.Address AddressState m,
    HasStorageDB m
  ) =>
  (Keccak256 -> Maybe (Map Text Text)) ->
  GenesisInfo ->
  Block ->
  Maybe Word256 ->
  m ()
populateStorageDBs getMetadata genesisInfo genesisBlock genesisChainId = do
  -- Step 1: State Root Management - Retrieve current state root and temporarily replace it
  sr <- getStateRoot genesisChainId

  -- Step 2: Kafka Topic Setup - Ensure StateDiff topic exists for event streaming
  liftIO . runKafkaMConfigured "strato-init" $ do
    assertStateDiffTopicCreation
  let pub sd vmes = do
        commitSqlDiffs sd
        void $ produceVMEvents vmes
  populateStorageDBs' getMetadata genesisInfo genesisBlock genesisChainId sr pub

populateStorageDBs' ::
  ( MonadIO m,
    MonadLogger m,
    HasCodeDB m,
    HasStateDB m,
    HasHashDB m,
    HasStorageDB m,
    Selectable Ad.Address AddressState m
  ) =>
  (Keccak256 -> Maybe (Map Text Text)) ->
  GenesisInfo ->
  Block ->
  Maybe Word256 ->
  MP.StateRoot ->
  (StateDiff.StateDiff -> [VMEvent] -> m ()) ->
  m ()
populateStorageDBs' getMetadata genesisInfo genesisBlock genesisChainId sr pub = do
  mSR <- A.lookup (A.Proxy @MP.StateRoot) (Nothing :: Maybe Word256)
  A.insert (A.Proxy @MP.StateRoot) (Nothing :: Maybe Word256) sr

  -- Step 3: Address Processing - Iterate through all genesis account addresses
  let addresses = acctInfoAddress <$> genesisInfoAccountInfo genesisInfo
      events = genesisInfoEvents genesisInfo

  for_ addresses $ \address -> do
    -- Fetch full address state from the state database
    fullAddressState <- A.selectWithDefault (A.Proxy @AddressState) address

    $logInfoS "initgen" $ T.pack $
      "##################### writing to DBs: " ++ format address

    -- Apply special filtering for Vitu vehicle manager contract (0x7000...0000)
    -- to prevent performance issues with large arrays
    -- For now, we are just clumsily filtering out any state changes for the
    -- Vitu vehicle manager, since this contract has giant arrays that would
    -- choke strato (yes, this temprary feature is hardcoded into the whole
    -- platform for one client)
    let acct = address
        filteredAddressState =
          if address /= Ad.Address 0x7000000000000000000000000000000000000000
            then fullAddressState
            else fullAddressState {addressStateContractRoot = MP.blankStateRoot}
        fullAddrStates = [(acct, fullAddressState)]
        filteredAddrStates = [(acct, filteredAddressState)]
        squashMap f = fmap concat . mapM (uncurry f) . Map.toList

    -- Step 4: State Diff Generation - Create SQL database diffs for account creation
    fullAccountDiffs <- mapM eventualAccountState . Map.fromList $ fullAddrStates
    -- Step 5: VM Event Production - Generate and publish VM events to Kafka
    let addressEvents = Map.findWithDefault S.empty address  events
    vmEvents <- squashMap (toAction addressEvents) =<< mapM eventualAccountState (Map.fromList filteredAddrStates)
    pub (mkStateDiff fullAccountDiffs) vmEvents

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
      ( MonadLogger m
      , MonadIO m
      , HasCodeDB m
      , HasStorageDB m
      , Selectable Ad.Address AddressState m
      )
      => S.Seq Event
      -> Ad.Address
      -> AccountDiff 'Eventual
      -> m [VMEvent]
    toAction addressEvents a d = do
      let ch = codeHash d
      cPtr <- fromMaybe ch <$> resolveCodePtr ch
      let
          theMetadata = getMetadata $ genesisBlockCodePtr cPtr
          creator' = fromMaybe "" mkCreator
          creatorAddress' = mkCreatorAddress
          originAddress' = mkOriginAddress

      appName' <- (\case Just (SolidVMCode n _) -> T.pack n; _ -> "") <$> resolveCodePtrParent ch
      (abstrs, maps, arrs, cc) <- case cPtr of
        SolidVMCode contractName' codeHash' -> do
          -- Maybe the typechecking should be done elsewhere, but this will
          -- allow us to prevent faulty code collections from going into the
          -- genesis block
          cc <- codeCollectionFromHash True codeHash'
          case cc ^. CC.contracts . at contractName' of
            Nothing -> do
              $logWarnS "populateStorageDBs/toAction" . T.pack $
                "Couldn't find a contract named " ++ contractName' ++
                " in code collection " ++ format codeHash'
              pure (Map.empty, [], [], cc)
            Just contract' -> do
              let !abstracts' = getAbstractParentsFromContract contract' cc
                  !mappings = getMapNamesFromContract contract'
                  !arrays = getArrayNamesFromContract contract'
              $logInfoS "populateStorageDBs/toAction" . T.pack $
                "creator: " ++ T.unpack creator' ++ ", app: "
                ++ T.unpack appName'
              $logInfoS "populateStorageDBs/toAction" . T.pack $
                "creatorAddress: " ++ T.unpack creatorAddress' ++
                ", originAddress: " ++ T.unpack originAddress'
              !abstrs' <- Map.fromList <$> traverse (resolveNameParts a creator' appName') abstracts'
              pure (abstrs', mappings, arrays, cc)
        _ -> pure (Map.empty, [], [], emptyCodeCollection)
      let cca = case ch of
            SolidVMCode n _ ->
              let
                application' = T.pack n
                codeCollection' = () <$ cc
                codeCollectionAdded =
                  CodeCollectionAdded codeCollection' ch creator' application' abstrs maps
              in Just codeCollectionAdded
            ExternallyOwned _ -> Nothing
            CodeAtAccount {} -> Nothing
          act = Just . NewAction $ A.Action
            { A._blockHash = blockHeaderHash $ blockHeader genesisBlock,
              A._blockTimestamp =
                blockHeaderTimestamp $ blockHeader genesisBlock,
              A._blockNumber =
                blockHeaderBlockNumber $ blockHeader genesisBlock,
              A._transactionHash = rlpHash a,
              A._transactionSender = Ad.Address 0,
              A._actionData =
                OMap.singleton (a,
                  A.ActionData
                    cPtr
                    emptyCodeCollection
                    creator'
                    mkCreator
                    originAddress'
                    appName'
                    storageDiff
                    abstrs maps arrs
                    [A.Create]),
              A._src = join $ fmap (Map.lookup "src") theMetadata,
              A._name = join $ fmap (Map.lookup "name") theMetadata,
              A._events = addressEvents,
              A._delegatecalls = S.empty
            }
      pure $ catMaybes [cca, act]
      where

        fromDiff :: Diff a 'Eventual -> a
        fromDiff (Value v) = v

        mkCreator =
            (\case BString str -> Just $ T.decodeUtf8 str; _ -> Nothing)
          . rlpDecode
          . rlpDeserialize =<< lookupSolidDiff ".:creator" storageDiff

        mkCreatorAddress =
            (\case BAccount (NamedAccount a' _) -> T.pack $ show a'; _ -> "")
          . maybe BDefault (rlpDecode . rlpDeserialize)
          $ lookupSolidDiff ".:creatorAddress" storageDiff

        mkOriginAddress =
            (\case BAccount (NamedAccount a' _) -> T.pack $ show a'; _ -> "")
          . maybe BDefault (rlpDecode . rlpDeserialize)
          $ lookupSolidDiff ".:originAddress" storageDiff

        storageDiff = case storage d of
          SolidVMDiff m -> A.SolidVMDiff $ Map.map fromDiff m
          EVMDiff m -> A.EVMDiff $ Map.map fromDiff m

        genesisBlockCodePtr (ExternallyOwned ch') = ch'
        genesisBlockCodePtr (SolidVMCode _ ch') = ch'
        genesisBlockCodePtr cp =
          error $ "Could not resolve code ptr in genesis block" ++ show cp

        lookupSolidDiff k (A.SolidVMDiff m) = Map.lookup k m
        lookupSolidDiff _ _                 = Nothing


bootstrapIndexer :: OutputBlock -> IO ()
bootstrapIndexer obGB = do
  let clientId = fst ApiIndexer.kafkaClientIds
  putStrLn "About to bootstrap index events"
  res <-
    runKafkaMConfigured clientId $
    IdxKafka.produceIndexEvents [IdxModel.RanBlock obGB]

  print res
  putStrLn "bootstrapIndex genesis seed successful!"
