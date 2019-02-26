{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE LambdaCase        #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TupleSections     #-}
{-# LANGUAGE TemplateHaskell   #-}

module Blockchain.GenesisBlock (
  initializeGenesisBlock,
  BackupType(..)
) where


import           Control.Monad
import           Control.Monad.Logger
import           Control.Monad.IO.Class
import           Control.Monad.Trans.Resource
import qualified Data.ByteString.Base16                       as B16
import qualified Data.ByteString.Char8                        as C8
import qualified Data.ByteString.Lazy.Char8                   as BLC
import           Data.Either                                  (isLeft)
import           Data.Map.Strict                              (Map)
import           Data.Maybe
import qualified Data.JsonStream.Parser                       as JS
import           Data.Text                                    (Text)
import qualified Data.Text                                    as T
import           System.Directory

import           Blockchain.BackupBlocks
import qualified Blockchain.Data.Action                       as A
import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.BlockDB
import           Blockchain.Data.DataDefs
import           Blockchain.Data.Extra
import           Blockchain.Data.GenesisBlock
import           Blockchain.Data.GenesisInfo
import           Blockchain.Data.RLP
import           Blockchain.Data.ChainInfo
import qualified Blockchain.Database.MerklePatricia           as MP
import qualified Blockchain.Database.MerklePatricia.ForEach   as MP
import           Blockchain.DB.AddressStateDB
import           Blockchain.DB.CodeDB
import           Blockchain.DB.HashDB
import qualified Blockchain.DB.MemAddressStateDB              as Mem
import           Blockchain.DB.SQLDB
import           Blockchain.DB.StateDB
import           Blockchain.DB.StorageDB
import           Blockchain.ExtWord
import           Blockchain.Format
import           Blockchain.SHA
import           Blockchain.Stream.VMEvent
import           Blockchain.Util


import           Blockchain.Strato.StateDiff          hiding (StateDiff (chainId, blockHash, stateRoot))
import qualified Blockchain.Strato.StateDiff          as StateDiff (StateDiff (chainId, blockHash, stateRoot))
import           Blockchain.Strato.StateDiff.Database
import           Blockchain.Strato.StateDiff.Kafka    (assertTopicCreation, writeActionJSONToKafka, filterResponse)

import           Blockchain.MilenaTools               (commitSingleOffset)
import           Blockchain.Sequencer.Bootstrap       (bootstrapSequencer)
import           Blockchain.Sequencer.Event           (OutputBlock)
import qualified Network.Kafka                        as K
import qualified Network.Kafka.Protocol               as KP

import qualified Data.Map                             as Map

import           Blockchain.EthConf                   (runKafkaConfigured)
import qualified Blockchain.Strato.Indexer.ApiIndexer as ApiIndexer
import qualified Blockchain.Strato.Indexer.IContext   as IContext
import qualified Blockchain.Strato.Indexer.Kafka      as IdxKafka
import qualified Blockchain.Strato.Indexer.Model      as IdxModel
import qualified Blockchain.Strato.Model.Address      as Ad
import           Blockchain.Strato.Model.Class
import qualified Blockchain.Strato.RedisBlockDB       as RBDB
import qualified Database.Persist.Postgresql          as SQL

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
                                  "s":_ -> []
                                  ["a", a, b] -> [NonContract (Ad.Address (parseHex a)) (read b)]
                                  ["a", a, b, c] -> [ContractNoStorage (Ad.Address (parseHex a)) (read b) (SHA (parseHex c))]
                                  _ -> error $ "invalid AccountInfo line: " ++ line
      return . concatMap parseAccounts . lines $ accountInfoString

getGenesisBlockAndPopulateInitialMPs :: (MonadIO m, HasCodeDB m, HasHashDB m, Mem.HasMemAddressStateDB m,
                                         HasStateDB m, HasStorageDB m)
                                     => String
                                     -> [Ad.Address]
                                     -> m ([(AccountInfo, CodeInfo)], Block)
getGenesisBlockAndPopulateInitialMPs genesisBlockName extraFaucets = do
    theJSONString <- liftIO . BLC.readFile $ genesisBlockName ++ "Genesis.json"
    let genesis = JS.parseLazyByteString genesisParser theJSONString
        theJSON = case genesis of
                      [x] -> x
                      _ -> error $ "invalid genesis: " ++ show genesis
        faucetBalance = 0x1000000000000000000000000000000000000000000000000000000000000
        faucetAccounts = map (flip NonContract faucetBalance) extraFaucets
        theJSON' = theJSON{genesisInfoAccountInfo = faucetAccounts ++ (genesisInfoAccountInfo theJSON)}
    extraAccounts <- liftIO . readSupplementaryAccounts $ genesisBlockName
    genesisInfoToGenesisBlock theJSON' genesisBlockName extraAccounts

data BackupType = NoBackup | BlockBackup | MPBackup

initializeGenesisBlock :: ( MonadResource m
                          , HasCodeDB m
                          , HasHashDB m
                          , Mem.HasMemAddressStateDB m
                          , RBDB.HasRedisBlockDB m
                          , HasSQLDB m
                          , HasStateDB m
                          , HasStorageDB m
                          , MonadLogger m
                          )
                       => BackupType
                       -> String
                       -> [Ad.Address]
                       -> m ()
initializeGenesisBlock backupType genesisBlockName extraFaucets = do
    $logInfoS "initgen" "Begin of initgen"
    (srcInfo, genesisBlock, obGB) <-
        case backupType of
            NoBackup -> do
                (si, gb) <- getGenesisBlockAndPopulateInitialMPs genesisBlockName extraFaucets
                _ <- produceVMEvents [ChainBlock gb]
                obGB <- liftIO $ bootstrapSequencer gb
                putGenesisHash $ blockHash gb
                return (si, gb, obGB)
            BlockBackup -> do
                (si, gb) <- getGenesisBlockAndPopulateInitialMPs genesisBlockName extraFaucets
                _ <- produceVMEvents [ChainBlock gb]
                obGB <- liftIO $ bootstrapSequencer gb
                backupBlocks
                putGenesisHash $ blockHash gb
                return (si, gb, obGB)
            MPBackup -> error "MPBackup called"
            --    gb <- backupMP
            --    setStateDBStateRoot $ blockDataStateRoot $ blockBlockData gb
            --    return (gb, undefined)
    $logInfoS "initgen" "Initial merkle patricia tries succussfully created"
    [genBId] <- putBlocks [(SHA 0, 0)] [genesisBlock] False
    $logInfoS "initgen" "Genesis Block put"
    $logInfoS "initgen" "State diff has been generated"

    let genesisChainId = Nothing -- TODO: It's possible that we would call this function for private chain creation
    $logInfoS "initgen" "Beginning to write to redis"
    void . RBDB.withRedisBlockDB $ RBDB.forceBestBlockInfo
        (blockHash genesisBlock)
        (blockDataNumber . blockBlockData $ genesisBlock)
        (blockDataDifficulty . blockBlockData $ genesisBlock)
    $logInfoS "initgen" "best block info inserted"
    liftIO (bootstrapIndexer genBId obGB)
    $logInfoS "initgen" "indexer has been bootstrapped"
    let rewrite (_, CodeInfo bin src name) = (superProprietaryStratoSHAHash bin, Map.fromList [("src", src),("name",name)])
        metadatas = Map.fromList . map rewrite $ srcInfo
        findMetadata = flip Map.lookup metadatas
    populateStorageDBs findMetadata genesisBlock genesisChainId
    $logInfoS "initgen" "populateStorageDBs is done"

--------------------------------------
populateStorageDBs::(MonadLogger m, HasSQLDB m, HasCodeDB m, HasStateDB m, HasHashDB m) =>
                    (SHA -> Maybe (Map Text Text)) -> Block -> Maybe Word256 -> m ()
populateStorageDBs getMetadata genesisBlock genesisChainId = do

    accountDB <- getStateDB
    res <- liftIO . runKafkaConfigured "strato-init" $ do
      assertTopicCreation

    case res of
     Right () -> return ()
     Left err -> error . show $ err

    MP.forEach accountDB $ \keyHash value -> do
      address <- fmap (fromMaybe (error $ "missing key value in hash table: " ++ C8.unpack (B16.encode $ nibbleString2ByteString keyHash))) $ getAddressFromHash keyHash

      $logInfoS "initgen" $ T.pack $ "##################### writing to DBs: " ++ format address

      --For now, we are just clumsily filtering out any state changes for the Vitu vehicle manager,
      --since this contract has giant arrays that would choke strato
      --(yes, this temprary feature is hardcoded into the whole platform for one client)
      let fullAddressState = rlpDecode . rlpDeserialize . rlpDecode $ value::AddressState
          filteredAddressState =
            if (address /= Ad.Address 0x7000000000000000000000000000000000000000)
            then fullAddressState
            else fullAddressState{addressStateContractRoot=MP.blankStateRoot}
          fullAddrStates = [(address, fullAddressState)]
          filteredAddrStates = [(address, filteredAddressState)]
          toAction a d = A.Action
            { A._actionBlockHash = blockHeaderHash $ blockHeader genesisBlock
            , A._actionBlockTimestamp = blockHeaderTimestamp $ blockHeader genesisBlock
            , A._actionBlockNumber = blockHeaderBlockNumber $ blockHeader genesisBlock
            , A._actionTransactionHash = SHA $ fromMaybe 0 genesisChainId
            , A._actionTransactionChainId = genesisChainId
            , A._actionTransactionSender = Ad.Address 0
            , A._actionData = Map.singleton a $
                                A.ActionData
                                  (codeHash d)
                                  EVM
                                  (case storage d of
                                    EVMDiff m -> A.ActionEVMDiff $ Map.map fromDiff m
                                    SolidVMDiff _ -> error "TODO(tim): SolidVMDiff genesis block support")
                                  [A.emptyCallData]
            , A._actionMetadata = getMetadata (codeHash d)
            }
          fromDiff :: Diff Word256 'Eventual -> Word256
          fromDiff (Value v) = v
          squashMap f = map (uncurry f) . Map.toList

      fullAccountDiffs <- mapM eventualAccountState . Map.fromList $ fullAddrStates
      filteredActions <- fmap (squashMap toAction) . mapM eventualAccountState $ Map.fromList filteredAddrStates

      let statediff ad = StateDiff {
            StateDiff.chainId   = genesisChainId,
            blockNumber         = 0,
            StateDiff.blockHash = blockHash genesisBlock,
            StateDiff.stateRoot = MP.StateRoot . blockHeaderStateRoot $ blockHeader genesisBlock,
            createdAccounts     = ad,
            deletedAccounts     = Map.empty,
            updatedAccounts     = Map.empty
            }

      commitSqlDiffs (statediff fullAccountDiffs)
      mErr <- liftIO . runKafkaConfigured "strato-init" $ writeActionJSONToKafka filteredActions
      case filterResponse <$> mErr of
       Right [] -> return ()
       Right errs -> error . show $ errs
       Left err -> error . show $ err

bootstrapIndexer :: SQL.Key BlockDataRef -> OutputBlock -> IO ()
bootstrapIndexer key obGB =
    let clientId = fst ApiIndexer.kafkaClientIds
        consumer = snd ApiIndexer.kafkaClientIds
        topic    = IContext.targetTopicName
        ibbi     = IContext.IndexerBestBlockInfo key
        mkMeta   = KP.Metadata . KP.KString . C8.pack . show $ IContext.unIBBI ibbi
        commit   = do
            putStrLn $ "Bootstrapping indexer with " ++ show ibbi
            runKafkaConfigured clientId $
                commitSingleOffset consumer topic 0 0 mkMeta
        runner = commit >>= \case
            Right (Right _) -> do
                putStrLn "bootstrapIndex API checkpoint successful!"
                res <- runKafkaConfigured clientId $
                      IdxKafka.writeIndexEvents [IdxModel.RanBlock obGB]
                when (isLeft res) . error $ "bootstrapping index events failed: " ++ show res
                print res
                putStrLn "bootstrapIndex genesis seed successful!"
            Right (Left l) -> do
                putStrLn $ "will retry bootstrapIndex as I got a broker error: " ++ show (l :: KP.KafkaError)
                runner
            (Left l) -> do
                putStrLn $ "will retry bootstrapIndexer as I got a client error: " ++ show (l :: K.KafkaClientError)
                runner
    in runner
