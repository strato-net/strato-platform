{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TupleSections     #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeOperators     #-}

module Blockchain.GenesisBlock (
  initializeGenesisBlock,
) where


import           Control.Monad
import           Blockchain.Output
import           Control.Monad.Change.Alter                   (Alters)
import           Control.Monad.Change.Modify                  (Accessible)
import           Control.Monad.IO.Class
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

import qualified Blockchain.Strato.Model.Action               as A
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

import           Text.Format

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
                                  ["a", a, b, c] -> [ContractNoStorage (Ad.Address (parseHex a)) (read b) (EVMCode $ SHA (parseHex c))]
                                  _ -> error $ "invalid AccountInfo line: " ++ line
      return . concatMap parseAccounts . lines $ accountInfoString

getGenesisBlockAndPopulateInitialMPs :: ( MonadIO m
                                        , MonadLogger m
                                        , HasCodeDB m
                                        , HasHashDB m
                                        , Mem.HasMemAddressStateDB m
                                        , HasStateDB m
                                        , HasStorageDB m
                                        , HasMemStorageDB m
                                        , (Ad.Address `Alters` AddressState) m
                                        )
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

initializeGenesisBlock :: ( HasCodeDB m
                          , HasHashDB m
                          , Mem.HasMemAddressStateDB m
                          , Accessible RBDB.RedisConnection m
                          , HasSQLDB m
                          , HasStateDB m
                          , HasStorageDB m
                          , HasMemStorageDB m
                          , MonadLogger m
                          , (Ad.Address `Alters` AddressState) m
                          )
                       => String
                       -> [Ad.Address]
                       -> m ()
initializeGenesisBlock genesisBlockName extraFaucets = do
    $logInfoS "initgen" "Begin of initgen"
    (srcInfo, genesisBlock) <- getGenesisBlockAndPopulateInitialMPs genesisBlockName extraFaucets
    _ <- produceVMEvents [ChainBlock genesisBlock]
    obGB <- liftIO $ bootstrapSequencer genesisBlock
    putGenesisHash $ blockHash genesisBlock
    $logInfoS "initgen" "Initial merkle patricia tries succussfully created"
    [genBId] <- putBlocks [(genesisBlock, blockDataDifficulty (blockBlockData genesisBlock))] False
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
                                  (EVMCode ch)
                                  EVM
                                  (case storage d of
                                    EVMDiff m -> A.ActionEVMDiff $ Map.map fromDiff m
                                    SolidVMDiff _ -> error "TODO(tim): SolidVMDiff genesis block support")
                                  [A.emptyCallData]
            , A._actionMetadata = getMetadata ch
            }
            where ch =
                    case codeHash d of
                      EVMCode ch' -> ch'
                      SolidVMCode _ ch' -> ch'
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
