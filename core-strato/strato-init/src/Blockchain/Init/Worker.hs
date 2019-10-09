{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE UndecidableInstances #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# OPTIONS_GHC -fno-warn-unused-top-binds #-}
module Blockchain.Init.Worker (runWorker) where

import Control.Concurrent
import Control.Lens.Combinators (uses)
import Control.Monad
import Control.Monad.IO.Class
import Control.Monad.Trans.Reader
import Control.Monad.Trans.Except
import Control.Monad.Trans.Resource
import Control.Monad.Trans.State
import Conduit
import qualified Data.Aeson as Ae
import Data.Either.Combinators (whenLeft)
import Data.List (nub)
import qualified Data.Map as M
import Data.String (fromString)
import qualified Data.Text as T
import qualified Data.Text.IO as TIO
import Data.Yaml (encodeFile)
import Database.Persist.Postgresql
import System.Directory
import System.Exit
import System.FilePath ((</>))
import System.IO.Temp
import Text.Printf
import Turtle (chmod, roo, fromText)

import BlockApps.Logging
import Blockchain.APIFiles (inflateDir)
import qualified Blockchain.Data.Blockchain as Blockchain
import qualified Blockchain.Data.DataDefs as DataDefs
import Blockchain.DB.CodeDB
import qualified Blockchain.EthConf as UEC
import qualified Blockchain.EthConf.Model as EC
import Blockchain.GenesisBlock
import Blockchain.Init.Monad
import Blockchain.Init.Protocol
import Blockchain.MilenaTools
import qualified Executable.EthDiscoverySetup as EthDiscovery
import Network.Kafka as K
import Network.Kafka.Protocol as K
import qualified Text.Colors as CL

runWorker :: K.KafkaAddress -> LoggingT IO ()
runWorker kaddr = do
  withSystemTempFile "genesis_block" $ \tf _ -> do
    workerKafka kaddr $ do
      firstOffset <- start
      runConduit $ yieldMany [firstOffset..]
                .| mapMC (\o -> (o,) <$> receiveEvent o)
                .| takeWhileC ((/= InitComplete) . snd)
                .| iterMC ($logInfoLS "runWorker/inbound")
                .| mapMC (\(o, ev) -> lift . lift $ process tf o ev)
                .| mapM_C commit
    $logInfoS "runWorker" "All events received"
    runResourceT . runSetupDBM $ do
      $logInfoS "runWorker" "Adding empty code"
      void $ addCode EVM mempty -- blank code is the default for Accounts, but gets added nowhere else.
      $logInfoS "runWorker" "Processing genesis block"
      initializeGenesisBlock tf []
    $logInfoS "runWorker" "done."

makeReadOnly :: FilePath -> IO ()
makeReadOnly = void . chmod roo . fromText . T.pack

consumerGroup :: K.ConsumerGroup
consumerGroup = "init-worker"

workerKafka :: MonadIO m => K.KafkaAddress -> StateT KafkaState (ExceptT KafkaClientError m) a -> m a
workerKafka kaddr mv = do
  eRes <- runExceptT $ evalStateT mv (K.mkKafkaState "init-worker" kaddr)
  either (liftIO . die . ("worker: "++) . show) return eRes

commit :: Kafka k => K.Offset -> k ()
commit koffset = either (liftIO . die . ("commit: "++) . show) return =<< commitSingleOffset consumerGroup initTopic 0 koffset ""

start :: K.Kafka k => k K.Offset
start = do
  eOff <- fetchSingleOffset consumerGroup initTopic 0
  case eOff of
    Left K.UnknownTopicOrPartition -> commit 0 >> start
    Left e -> liftIO . die $ "start: " ++ show e
    Right off -> return $ fst off

process :: FilePath -> K.Offset -> EventInit -> LoggingT IO K.Offset
process pathRoot off = (>> return off) . \case
  -- Note: EthConf must come first, but otherwise the order doesn't (shouldn't ?) matter.
  EthConf ec -> do
    let dir = ".ethereumH"
    liftIO $ createDirectoryIfMissing True dir
    liftIO $ encodeFile (dir </> "ethconf.yaml") ec
    liftIO $ makeReadOnly $ dir </> "ethconf.yaml"
    let pgconf = EC.sqlConfig ec
        rawConn = EC.postgreSQLConnectionString pgconf{EC.database = ""}
        globalConn = EC.postgreSQLConnectionString pgconf{EC.database = "blockchain"}
        localConn = EC.postgreSQLConnectionString pgconf
        db = EC.database pgconf
    Blockchain.migrateDB globalConn
    currPath <- liftIO $ getCurrentDirectory
    void $ Blockchain.insertBlockchain globalConn currPath . EC.peerId . EC.ethUniqueId $ ec
    $logInfoS "ethconf/Create Database" . T.pack $ CL.yellow db
    $logInfoLS "ethconf/Create Database" rawConn
    let query = T.pack $ "CREATE DATABASE " ++ show db ++ ";"

    withPostgresqlConn rawConn (runReaderT (rawExecute query []) :: SqlWriteBackend -> LoggingT IO ())

    withPostgresqlConn localConn $ runReaderT $ do
      $logInfoS "ethconf/migrate" . T.pack $ CL.yellow ">>>> Migrating eth"
      $logInfoLS "ethconf/migrateconn" localConn
      runMigration DataDefs.migrateAll
      $logInfoS "ethconf/migrate" . T.pack $ CL.yellow ">>>> Indexing eth"
      runMigration DataDefs.indexAll

  PeerList bootnodes -> do
    $logInfoS "ethconf/bootnodes" . T.pack $ CL.yellow ">>>> Inserting bootnodes"
    $logInfoLS "ethconf/bootnodes" bootnodes
    EthDiscovery.setup bootnodes

  TopicList topics -> liftIO $ do
    let uniqueTopicMap = M.fromList topics
    let topicList = map (fromString . snd) topics
    encodeFile (".ethereumH" </> "topics.yaml") uniqueTopicMap
    makeReadOnly $ ".ethereumH" </> "topics.yaml"

    res <- UEC.runKafkaConfigured "init-worker" $ do
      let waitForMetas = do
            K.updateMetadatas topicList
            let findError (TopicMetadata (e, _, _)) = e
            errors <- uses stateTopicMetadata (nub . map findError . M.elems)
            case errors of
              [NoError] -> return ()
              _ -> liftIO (threadDelay 100000) >> waitForMetas
      waitForMetas
    whenLeft res $ \err ->
      die $ printf "error connecting to kafka (%s): %s" (show $ EC.kafkaConfig UEC.ethConf) (show err)
  ApiConfig filePairs -> liftIO $ inflateDir filePairs

  GenesisBlock gb -> liftIO $ do
    let blockFile = pathRoot ++ "Genesis.json"
    Ae.encodeFile blockFile gb
    makeReadOnly blockFile

  GenesisAccounts acs -> liftIO $ do
    let accountFile = pathRoot ++ "AccountInfo"
    TIO.appendFile accountFile acs

  InitComplete -> liftIO $ die "InitComplete shouldn't be here"
