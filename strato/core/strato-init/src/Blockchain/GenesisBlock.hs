{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.GenesisBlock
  ( initializeGenesisBlock,
    buildGenesisInfo,
  )
where

import BlockApps.Logging
import BlockApps.X509.Certificate
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
import Blockchain.Data.ChainInfo
import Blockchain.Data.Extra
import Blockchain.Data.GenesisBlock
import Blockchain.Data.GenesisInfo
import Blockchain.Data.RLP
import qualified Blockchain.Data.TXOrigin as Origin
import Blockchain.Data.ValidatorRef
import qualified Blockchain.Database.MerklePatricia as MP
import qualified Blockchain.Database.MerklePatricia.ForEach as MP
import Blockchain.EthConf
import Blockchain.Generation
  ( insertCertRegistryContract,
    insertMercataGovernanceContract,
    insertUserRegistryContract,
    readCertsFromGenesisInfo,
    readValidatorsFromGenesisInfo,
  )
import Blockchain.Sequencer.Bootstrap (bootstrapSequencer)
import Blockchain.Sequencer.Event (OutputBlock(..))
import Blockchain.SolidVM.CodeCollectionDB
import qualified Blockchain.Strato.Indexer.ApiIndexer as ApiIndexer
import qualified Blockchain.Strato.Indexer.Kafka as IdxKafka
import qualified Blockchain.Strato.Indexer.Model as IdxModel
import qualified Blockchain.Strato.Model.Account as Ac
import qualified Blockchain.Strato.Model.Address as Ad
import Blockchain.Strato.Model.ChainMember
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Util
import Blockchain.Strato.Model.Validator
import qualified Blockchain.Strato.RedisBlockDB as RBDB
import Blockchain.Strato.StateDiff hiding (StateDiff (blockHash, chainId, stateRoot))
import qualified Blockchain.Strato.StateDiff as StateDiff (StateDiff (blockHash, chainId, stateRoot))
import Blockchain.Strato.StateDiff.Database
import Blockchain.Strato.StateDiff.Kafka (assertStateDiffTopicCreation)
import qualified Blockchain.Stream.Action as A
import Blockchain.Stream.VMEvent
import Control.Monad
import Control.Monad.Change.Alter (Alters, Selectable)
import Control.Monad.Composable.Redis
import Control.Monad.IO.Class
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Char8 as C8
import Data.Functor.Identity
import qualified Data.Map as Map
import Data.Map.Strict (Map)
import qualified Data.Map.Ordered as OMap
import Data.Maybe
import qualified Data.Sequence as S
import Data.Text (Text)
import qualified Data.Text as T
import SolidVM.Model.CodeCollection (emptyCodeCollection)
import System.Directory
import Text.Format

readSupplementaryAccounts :: String -> IO [AccountInfo]
readSupplementaryAccounts genesisBlockName = do
  let accountInfoFilename = genesisBlockName ++ "AccountInfo"
  exists <- doesFileExist accountInfoFilename
  if not exists
    then putStrLn "No AccountInfo file found" >> return []
    else do
      accountInfoString <- readFile $ accountInfoFilename
      let parseAccounts :: String -> [AccountInfo]
          parseAccounts line = case words line of
            [] -> []
            "s" : _ -> []
            ["a", a, b] -> [NonContract (Ad.Address (parseHex a)) (read b)]
            ["a", a, b, c] -> [ContractNoStorage (Ad.Address (parseHex a)) (read b) (ExternallyOwned $ unsafeCreateKeccak256FromWord256 (parseHex c))]
            _ -> error $ "invalid AccountInfo line: " ++ line
      return . concatMap parseAccounts . lines $ accountInfoString

buildGenesisInfo :: [Ad.Address] -> [X509Certificate] -> [ChainMemberParsedSet] -> [ChainMemberParsedSet] -> GenesisInfo -> GenesisInfo
buildGenesisInfo extraFaucets extraCerts validators admins gi =
  let faucetBalance = 0x1000000000000000000000000000000000000000000000000000000000000
      faucetAccounts = map (flip NonContract faucetBalance) extraFaucets
   in insertUserRegistryContract extraCerts
        . insertMercataGovernanceContract validators admins
        . insertCertRegistryContract extraCerts
        $ gi {genesisInfoAccountInfo = faucetAccounts ++ (genesisInfoAccountInfo gi)}

getGenesisBlockAndPopulateInitialMPs ::
  ( MonadIO m,
    MonadLogger m,
    HasCodeDB m,
    HasHashDB m,
    Mem.HasMemAddressStateDB m,
    HasStateDB m,
    HasStorageDB m,
    HasMemStorageDB m,
    (Ac.Account `Alters` AddressState) m,
    HasRedis m
  ) =>
  String ->
  m ([(Ad.Address, X509CertInfoState)], [Validator], ([(AccountInfo, CodeInfo)], Block))
getGenesisBlockAndPopulateInitialMPs genesisBlockName = do
  genesisInfo <- getGenesisInfoFromFile genesisBlockName
  let certs' = readCertsFromGenesisInfo genesisInfo
      validators = readValidatorsFromGenesisInfo genesisInfo
  extraAccounts <- liftIO . readSupplementaryAccounts $ genesisBlockName

  -- Need to insert the X509 certificates INTO Redis
  void . execRedis $ RBDB.insertRootCertificate
  $logInfoS "Redis/certInsertion" $ T.pack . format $ x509CertToCertInfoState rootCert

  extraCertInfoStates <-
    mapM
      ( \c -> do
          let c' = x509CertToCertInfoState c
              ua' = userAddress c'
          insertCert <- execRedis $ RBDB.registerCertificate ua' c'
          case insertCert of
            Right _ -> $logInfoS "Redis/certInsertion" $ T.pack "Certificate insertion was successful"
            Left e -> $logInfoS "Redis/certInsertion" $ T.pack $ "Certificate insertion failed: " ++ show e
          pure (ua', c')
      )
      certs'

  insertValidators <- execRedis $ RBDB.addValidators validators
  case insertValidators of
    Right _ -> $logInfoS "Redis/certInsertion" $ T.pack "Certificate insertion was successful"
    Left e -> $logInfoS "Redis/certInsertion" $ T.pack $ "Certificate insertion failed: " ++ show e

  (extraCertInfoStates,validators,) <$> genesisInfoToGenesisBlock genesisInfo genesisBlockName extraAccounts

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
    (Ac.Account `Alters` AddressState) m,
    Selectable Ac.Account AddressState m
  ) =>
  String ->
  m ()
initializeGenesisBlock genesisBlockName = do
  $logInfoS "initgen" "Begin of initgen"
  (extraCertInfoStates, validators, (srcInfo, genesisBlock)) <- getGenesisBlockAndPopulateInitialMPs genesisBlockName
  obGB <- liftIO $ bootstrapSequencer extraCertInfoStates genesisBlock
  putGenesisHash $ blockHash genesisBlock
  $logInfoS "initgen" "Initial merkle patricia tries successfully created"
  void $ putBlocks [genesisBlock] False
  $logInfoS "initgen" "Genesis Block put"
  $logInfoS "initgen" "State diff has been generated"

  void $ addRemoveValidator ([], validators)

  let genesisChainId = Nothing -- TODO: It's possible that we would call this function for private chain creation
  $logInfoS "initgen" "Beginning to write to redis"
  void . execRedis $ do
    RBDB.forceBestBlockInfo
      (blockHash genesisBlock)
      (number . blockBlockData $ genesisBlock)

  void . execRedis $
    RBDB.putBlock OutputBlock
    { obOrigin = Origin.Direct,
      obBlockData = blockBlockData genesisBlock,
      obReceiptTransactions = [],
      obBlockUncles = []
    }

  $logInfoS "initgen" "best block info inserted"
  liftIO $ bootstrapIndexer obGB
  $logInfoS "initgen" "indexer has been bootstrapped"
  let rewrite (_, CodeInfo bin src name) =
        ( hash bin,
          Map.fromList $
            [("src", src)]
              ++ case name of
                Nothing -> []
                Just n -> [("name", n)]
        )
      metadatas = Map.fromList . map rewrite $ srcInfo
      findMetadata = flip Map.lookup metadatas
  populateStorageDBs findMetadata genesisBlock genesisChainId
  $logInfoS "initgen" "populateStorageDBs is done"

--------------------------------------
populateStorageDBs ::
  ( MonadLogger m,
    HasSQLDB m,
    HasCodeDB m,
    HasStateDB m,
    HasHashDB m,
    Selectable Ac.Account AddressState m
  ) =>
  (Keccak256 -> Maybe (Map Text Text)) ->
  Block ->
  Maybe Word256 ->
  m ()
populateStorageDBs getMetadata genesisBlock genesisChainId = do
  sr <- getStateRoot genesisChainId
  liftIO . runKafkaMConfigured "strato-init" $ do
    assertStateDiffTopicCreation

  MP.forEach sr $ \keyHash value -> do
    address <- fmap (fromMaybe (error $ "missing key value in hash table: " ++ C8.unpack (B16.encode $ nibbleString2ByteString keyHash))) $ getAddressFromHash keyHash

    $logInfoS "initgen" $ T.pack $ "##################### writing to DBs: " ++ format address

    --For now, we are just clumsily filtering out any state changes for the Vitu vehicle manager,
    --since this contract has giant arrays that would choke strato
    --(yes, this temprary feature is hardcoded into the whole platform for one client)
    let acct = Ac.Account address genesisChainId
        fullAddressState = rlpDecode . rlpDeserialize . rlpDecode $ value :: AddressState
        filteredAddressState =
          if (address /= Ad.Address 0x7000000000000000000000000000000000000000)
            then fullAddressState
            else fullAddressState {addressStateContractRoot = MP.blankStateRoot}
        fullAddrStates = [(acct, fullAddressState)]
        filteredAddrStates = [(acct, filteredAddressState)]
        toAction a d =
          A.Action
            { A._blockHash = blockHeaderHash $ blockHeader genesisBlock,
              A._blockTimestamp = blockHeaderTimestamp $ blockHeader genesisBlock,
              A._blockNumber = blockHeaderBlockNumber $ blockHeader genesisBlock,
              A._transactionHash = unsafeCreateKeccak256FromWord256 $ fromMaybe 0 genesisChainId,
              A._transactionChainId = genesisChainId,
              A._transactionSender = Ac.Account (Ad.Address 0) genesisChainId,
              A._actionData =
                OMap.singleton (a,
                  A.ActionData
                    (codeHash d)
                    emptyCodeCollection
                    ""
                    Nothing
                    ""
                    ""
                    ( case codeHash d of
                        ExternallyOwned _ -> EVM
                        SolidVMCode _ _ -> SolidVM
                        CodeAtAccount _ _ -> error "CodeAtAccount not supported in genesis block"
                    )
                    ( case storage d of
                        SolidVMDiff m -> A.SolidVMDiff $ Map.map fromDiff m
                        EVMDiff m -> A.EVMDiff $ Map.map fromDiff m
                    )
                    Map.empty [] []
                    [A.Create]),
              A._metadata =
                getMetadata
                  ( case codeHash d of
                      ExternallyOwned ch' -> ch'
                      SolidVMCode _ ch' -> ch'
                      CodeAtAccount _ _ -> error "TODO: Encountered CodeAtAccount in genesis block"
                  ),
              A._events = S.empty,
              A._delegatecalls = S.empty
            }
        fromDiff :: Diff a 'Eventual -> a
        fromDiff (Value v) = v
        squashMap f = map (uncurry f) . Map.toList

    fullAccountDiffs <- mapM eventualAccountState . Map.fromList $ fullAddrStates
    filteredActions <- fmap (squashMap toAction) . mapM eventualAccountState $ Map.fromList filteredAddrStates

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

    forM_ (map (fromMaybe Map.empty . A._metadata) filteredActions) $ \md ->
      case (Map.lookup "src" md, Map.lookup "name" md) of
        (Just src, Just n) -> case runIdentity . runMemCompilerT $ compileSource False $ Map.singleton "" src of
          Right cc -> void $ produceVMEvents [CodeCollectionAdded (const () <$> cc) (SolidVMCode (T.unpack n) $ hash $ BC.pack $ T.unpack src) "" "" [] Map.empty []]
          Left _ -> pure ()
        _ -> return ()

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
