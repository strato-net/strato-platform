{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Init.Generator (
  mkAll
  ) where

import BlockApps.Logging
import qualified Blockchain.Data.DataDefs as DataDefs
import Blockchain.Data.GenesisInfo
import qualified Blockchain.Data.GenesisInfoOld as OLD
import qualified Blockchain.EthConf as UEC
import qualified Blockchain.EthConf.Model as EC
import Blockchain.DB.CodeDB
import Blockchain.GenesisBlock
import Blockchain.Init.EthConf
import Blockchain.GenesisBlocks.ProductionGenesisBlock
import Blockchain.Init.Monad
import Blockchain.Init.Options
import qualified Blockchain.Network as Net
import Blockchain.Strato.Model.Options (flags_network)
import Conduit
import Control.Monad
import Control.Monad.Composable.Kafka
import Control.Monad.Composable.Redis
import Control.Monad.Composable.SQL
import Control.Monad.Trans.Reader
import qualified Data.Aeson as JSON
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import Data.String
import qualified Data.Text as T
import qualified Text.Colors as CL
import qualified Data.Map as M
import qualified Data.Yaml as YAML
import Database.Persist.Postgresql
import qualified Executable.EthDiscoverySetup as EthDiscovery
import SelectAccessible ()
import System.FilePath ((</>))
import Turtle (chmod, roo)
import UnliftIO.Directory

createGenesisInfo :: MonadIO m => String -> m ()
createGenesisInfo _ = do
  let genesisInfo = productionGenesisBlock

  liftIO $ B.writeFile "genesis.json" . BL.toStrict $ JSON.encode genesisInfo
  liftIO $ putStrLn $ "Done. Output genesis block info was written"

convertGenesisFromOld :: MonadIO m => m ()
convertGenesisFromOld = do
  oldGenesis <- OLD.getGenesisInfo
  liftIO $ B.writeFile "genesis.json" . BL.toStrict $ JSON.encode $ convertFromOld oldGenesis
  liftIO $ putStrLn $ "Done. Output genesis block info was written"

mkAll :: (MonadLoggerIO m, MonadUnliftIO m, MonadFail m, HasKafka m) =>
         String -> m ()
mkAll network = do
  ethconf <- liftIO genEthConf

  let dir = ".ethereumH"
  liftIO $ createDirectoryIfMissing True dir
  liftIO $ YAML.encodeFile (dir </> "ethconf.yaml") ethconf
  liftIO $ makeReadOnly $ dir </> "ethconf.yaml"

  genesisExists <- doesFileExist "genesis.json"
  genesisOldExists <- doesFileExist "genesisOld.json"

  case (genesisExists, genesisOldExists) of
    (False, False) -> do
      $logInfoS "mkAll" "Creating 'genesis.json' using network name"
      createGenesisInfo network
    (False, True) -> do
      $logInfoS "mkAll" "Converting 'genesis.json' from old format 'genesisOld.json'"
      convertGenesisFromOld
    (True, _) -> do
      $logInfoS "mkAll" "Using provided 'genesis.json'"
      return ()


  let pgconf = EC.sqlConfig ethconf
      rawConn = EC.postgreSQLConnectionString pgconf {EC.database = ""}
      localConn = EC.postgreSQLConnectionString pgconf
      db = EC.database pgconf
  $logInfoS "ethconf/Create Database" . T.pack $ CL.yellow db
  $logInfoLS "ethconf/Create Database" rawConn
  let query = T.pack $ "CREATE DATABASE " ++ show db ++ ";"

  withPostgresqlConn rawConn (runReaderT (rawExecute query []))

  withPostgresqlConn localConn $
    runReaderT $ do
      $logInfoS "ethconf/migrate" . T.pack $ CL.yellow ">>>> Migrating eth"
      $logInfoLS "ethconf/migrateconn" localConn
      runMigration DataDefs.migrateAll
      $logInfoS "ethconf/migrate" . T.pack $ CL.yellow ">>>> Indexing eth"
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

  let uniqueTopicMap = M.fromList $ map (\x -> (x, x)) topics
  liftIO $ YAML.encodeFile (".ethereumH" </> "topics.yaml") uniqueTopicMap

  bootnodes <- case (flags_addBootnodes, flags_stratoBootnode) of
    (False, _) -> return Nothing
    (True, []) -> liftIO $ fmap (fmap $ map Net.webAddress) $ Net.getParams flags_network
    (True, _) -> return $ Just flags_stratoBootnode

  $logInfoS "ethconf/bootnodes" . T.pack $ CL.yellow ">>>> Inserting bootnodes"
  $logInfoLS "ethconf/bootnodes" bootnodes
  EthDiscovery.setup bootnodes

  runResourceT . runSetupDBM . runRedisM UEC.lookupRedisBlockDBConfig . runSQLM $ do
    $logInfoS "runWorker" "Adding empty code"
    void $ addCode EVM mempty -- blank code is the default for Accounts, but gets added nowhere else.
    $logInfoS "runWorker" "Processing genesis block"
    initializeGenesisBlock
    $logInfoS "runWorker" "done. here I am once again"

makeReadOnly :: FilePath -> IO ()
makeReadOnly = void . chmod roo
