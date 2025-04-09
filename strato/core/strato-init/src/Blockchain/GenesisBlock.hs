{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.GenesisBlock
  ( initializeGenesisBlock
  )
where

import BlockApps.Logging
import BlockApps.X509.Certificate
import Blockchain.BlockDB
import Blockchain.CertificateDB
import Blockchain.DB.AddressStateDB
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
import qualified Blockchain.Database.MerklePatricia.ForEach as MP
import Blockchain.EthConf
import Blockchain.Generation
  ( readCertsFromGenesisInfo,
    readValidatorsFromGenesisInfo,
  )
import Blockchain.Model.WrappedBlock (OutputBlock(..))
import Blockchain.Model.SyncState
import Blockchain.Sequencer.Bootstrap (bootstrapSequencer)
import Blockchain.SolidVM.CodeCollectionDB
import qualified Blockchain.Strato.Indexer.ApiIndexer as ApiIndexer
import qualified Blockchain.Strato.Indexer.Kafka as IdxKafka
import qualified Blockchain.Strato.Indexer.Model as IdxModel
import qualified Blockchain.Strato.Model.Address as Ad
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Util
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
import Control.Monad.Composable.Redis
import Control.Monad.IO.Class
import qualified Data.Aeson as Aeson
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Lazy as BL
import Data.Functor.Identity
import qualified Data.Map as Map
import Data.Map.Strict (Map)
import qualified Data.Map.Ordered as OMap
import Data.Maybe
import qualified Data.Sequence as S
import Data.Text (Text)
import qualified Data.Text as T
import qualified Data.Text.Encoding as T
import SolidVM.Model.CodeCollection (emptyCodeCollection)
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
  m ([(Ad.Address, X509CertInfoState)], [Validator], [CodeInfo], ([(AccountInfo, CodeInfo)], Block))
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

  (extraCertInfoStates, validators, genesisInfoCodeInfo genesisInfo,) <$> genesisInfoToGenesisBlock genesisInfo

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
  (extraCertInfoStates, validators, codeInfos, (srcInfo, genesisBlock)) <- getGenesisBlockAndPopulateInitialMPs
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
  populateStorageDBs findMetadata genesisBlock genesisChainId codeInfos
  $logInfoS "initgen" "populateStorageDBs is done"

--------------------------------------
populateStorageDBs ::
  ( MonadLogger m,
    HasSQLDB m,
    HasCodeDB m,
    HasStateDB m,
    HasHashDB m,
    Selectable Ad.Address AddressState m
  ) =>
  (Keccak256 -> Maybe (Map Text Text)) ->
  Block ->
  Maybe Word256 ->
  [CodeInfo] ->
  m ()
populateStorageDBs getMetadata genesisBlock genesisChainId codeInfos = do
  sr <- getStateRoot genesisChainId
  liftIO . runKafkaMConfigured "strato-init" $ do
    assertStateDiffTopicCreation

  forM_ codeInfos $ \(CodeInfo src mName) -> case mName of
      Just n -> do
        let srcMap = maybe (Map.singleton "" src) Map.fromList . Aeson.decode . BL.fromStrict $ T.encodeUtf8 src
        case runIdentity . runMemCompilerT $ compileSource False srcMap of
          Right cc -> do
            void $ produceVMEvents [CodeCollectionAdded (const () <$> cc) (SolidVMCode (T.unpack n) $ hash $ BC.pack $ T.unpack src) "" "" [] Map.empty []]
          Left _ -> pure ()
      _ -> return ()

  MP.forEach sr $ \keyHash value -> do
    address <- fmap (fromMaybe (error $ "missing key value in hash table: " ++ BC.unpack (B16.encode $ nibbleString2ByteString keyHash))) $ getAddressFromHash keyHash

    $logInfoS "initgen" $ T.pack $ "##################### writing to DBs: " ++ format address

    --For now, we are just clumsily filtering out any state changes for the Vitu vehicle manager,
    --since this contract has giant arrays that would choke strato
    --(yes, this temprary feature is hardcoded into the whole platform for one client)
    let acct = address
        fullAddressState = rlpDecode . rlpDeserialize . rlpDecode $ value :: AddressState
        filteredAddressState =
          if (address /= Ad.Address 0x7000000000000000000000000000000000000000)
            then fullAddressState
            else fullAddressState {addressStateContractRoot = MP.blankStateRoot}
        fullAddrStates = [(acct, fullAddressState)]
        filteredAddrStates = [(acct, filteredAddressState)]
        toAction a d = do
          cp <- resolveCodePtr $ codeHash d
          pure $ A.Action
            { A._blockHash = blockHeaderHash $ blockHeader genesisBlock,
              A._blockTimestamp = blockHeaderTimestamp $ blockHeader genesisBlock,
              A._blockNumber = blockHeaderBlockNumber $ blockHeader genesisBlock,
              A._transactionHash = unsafeCreateKeccak256FromWord256 $ fromMaybe 0 genesisChainId,
              A._transactionSender = Ad.Address 0,
              A._actionData =
                OMap.singleton (a,
                  A.ActionData
                    (codeHash d)
                    emptyCodeCollection
                    ""
                    Nothing
                    ""
                    ""
                    ( case cp of
                        Just (ExternallyOwned _) -> EVM
                        Just (SolidVMCode _ _) -> SolidVM
                        _ -> error $ "Could not resolve code ptr in genesis block" ++ show cp
                    )
                    ( case storage d of
                        SolidVMDiff m -> A.SolidVMDiff $ Map.map fromDiff m
                        EVMDiff m -> A.EVMDiff $ Map.map fromDiff m
                    )
                    Map.empty [] []
                    [A.Create]),
              A._metadata =
                getMetadata
                  ( case cp of
                      Just (ExternallyOwned ch') -> ch'
                      Just (SolidVMCode _ ch') -> ch'
                      _ -> error $ "Could not resolve code ptr in genesis block" ++ show cp
                  ),
              A._events = S.empty,
              A._delegatecalls = S.empty
            }
        fromDiff :: Diff a 'Eventual -> a
        fromDiff (Value v) = v
        squashMap f = mapM (uncurry f) . Map.toList

    fullAccountDiffs <- mapM eventualAccountState . Map.fromList $ fullAddrStates
    filteredActions <- squashMap toAction =<< mapM eventualAccountState (Map.fromList filteredAddrStates)

    let statediff ad =
          StateDiff
            { StateDiff.chainId = genesisChainId,
              blockNumber = 0,
              StateDiff.blockHash = blockHash genesisBlock,
              StateDiff.stateRoot = MP.StateRoot . blockHeaderStateRoot $ blockHeader genesisBlock,
              createdAccounts = ad,
              deletedAccounts = Map.empty,
              updatedAccounts = Map.empty
            }

    commitSqlDiffs (statediff fullAccountDiffs)


    _ <- produceVMEvents $ map NewAction filteredActions
    return ()

bootstrapIndexer :: OutputBlock -> IO ()
bootstrapIndexer obGB = do
  let clientId = fst ApiIndexer.kafkaClientIds
  putStrLn "About to bootstrap index events"
  res <-
    runKafkaMConfigured clientId $
    IdxKafka.produceIndexEvents [IdxModel.RanBlock obGB]

  print res
  putStrLn "bootstrapIndex genesis seed successful!"
