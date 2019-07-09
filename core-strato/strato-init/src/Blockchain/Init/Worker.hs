{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
module Blockchain.Init.Worker (runWorker) where

import Control.Concurrent
import Control.Monad
import Control.Monad.IO.Class
import Control.Monad.Trans.Reader
import Control.Monad.Trans.Resource
import Conduit
import qualified Data.Aeson as Ae
import Data.Either.Combinators (whenLeft)
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
import qualified Executable.EthDiscoverySetup as EthDiscovery
import Network.Kafka as K
import qualified Text.Colors as CL

runWorker :: LoggingT (ResourceT IO) ()
runWorker = do
  withSystemTempFile "genesis_block" $ \tf _ -> do
    runConduit $ repeatWhileMC (liftIO receiveEvent) (/= InitComplete)
                          .| iterMC ($logInfoLS "runWorker/inbound")
                          .| mapM_C (process tf)
    $logInfoS "runWorker" "All events received"
    runSetupDBM $ do
      $logInfoS "runWorker" "Adding empty code"
      void $ addCode EVM mempty -- blank code is the default for Accounts, but gets added nowhere else.
      $logInfoS "runWorker" "Processing genesis block"
      initializeGenesisBlock tf []
    $logInfoS "runWorker" "done."

process :: FilePath -> EventInit -> LoggingT (ResourceT IO) ()
process pathRoot = \case
  -- Note: EthConf must come first, but otherwise the order doesn't (shouldn't ?) matter.
  EthConf ec -> do
    let dir = ".ethereumH"
    liftIO $ createDirectoryIfMissing True dir
    liftIO $ encodeFile (dir </> "ethconf.yaml") ec
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

    withPostgresqlConn rawConn (runReaderT (rawExecute query []) :: SqlWriteBackend -> LoggingT (ResourceT IO) ())

    runLoggingT $ withPostgresqlConn localConn $ runReaderT $ do
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

    res <- UEC.runKafkaConfigured "init-worker" $ K.updateMetadatas topicList
    whenLeft res $ \err ->
      die $ printf "error connecting to kafka (%s): %s" (show $ EC.kafkaConfig UEC.ethConf) (show err)
    -- Superstitions persist
    threadDelay 1000000
  ApiConfig filePairs -> liftIO $ inflateDir filePairs

  GenesisBlock gb -> do
    let blockFile = pathRoot ++ "Genesis.json"
    liftIO $ Ae.encodeFile blockFile gb

  GenesisAccounts acs -> do
    let accountFile = pathRoot ++ "AccountInfo"
    liftIO $ TIO.appendFile accountFile acs

  InitComplete -> liftIO $ die "InitComplete shouldn't be here"
