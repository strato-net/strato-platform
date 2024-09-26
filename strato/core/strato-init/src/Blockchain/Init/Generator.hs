{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Init.Generator (
  mkAll
  ) where

import BlockApps.Logging
import qualified Blockchain.Data.DataDefs as DataDefs
import qualified Blockchain.EthConf as UEC
import qualified Blockchain.EthConf.Model as EC
import Blockchain.Data.GenesisInfo
import Blockchain.DB.CodeDB
import Blockchain.GenesisBlock
import Blockchain.Init.EthConf
import Blockchain.Init.Monad
import Blockchain.Init.Options
import qualified Blockchain.Network as Net
import Blockchain.Strato.Model.Options (flags_network)
import Conduit
import Control.Monad
import Control.Monad.Catch
import Control.Monad.Composable.Kafka
import Control.Monad.Composable.Redis
import Control.Monad.Composable.SQL
import Control.Monad.Trans.Reader
import qualified Data.Aeson as Ae
import qualified Data.ByteString.Char8 as C8
import Data.FileEmbed
import Data.String
import qualified Data.Text as T
import qualified Text.Colors as CL
import qualified Data.Map as M
import Data.Text.Encoding (decodeUtf8)
import qualified Data.Text.IO as TIO
import qualified Data.Yaml as YAML
import Database.Persist.Postgresql
import qualified Executable.EthDiscoverySetup as EthDiscovery
import SelectAccessible ()
import System.Exit
import System.FilePath ((</>))
import Turtle (chmod, roo)
import UnliftIO.Directory
import UnliftIO.IO hiding (withFile)

genesisFiles :: [(FilePath, C8.ByteString)]
genesisFiles = $(embedDir "genesisBlocks")

mkAll :: (MonadLoggerIO m, MonadUnliftIO m, MonadFail m, MonadMask m, HasKafka m) =>
         String -> m ()
mkAll genesisBlockName = do
  ethconf <- liftIO genEthConf

  let dir = ".ethereumH"
  liftIO $ createDirectoryIfMissing True dir
  liftIO $ YAML.encodeFile (dir </> "ethconf.yaml") ethconf
  liftIO $ makeReadOnly $ dir </> "ethconf.yaml"

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

  let genesisFileName = genesisBlockName ++ "Genesis.json"
      accountInfoFileName = genesisBlockName ++ "AccountInfo"

  sendGenesisJson genesisFileName
  sendAccountInfo accountInfoFileName

  runResourceT . runSetupDBM . runRedisM UEC.lookupRedisBlockDBConfig . runSQLM $ do
    $logInfoS "runWorker" "Adding empty code"
    void $ addCode EVM mempty -- blank code is the default for Accounts, but gets added nowhere else.
    $logInfoS "runWorker" "Processing genesis block"
    initializeGenesisBlock genesisBlockName
    $logInfoS "runWorker" "done. here I am once again"

sendGenesisJson :: HasKafka m =>
                   FilePath -> m ()
sendGenesisJson genesisFilename = do
  fsFile <- doesFileExist genesisFilename
  eGenInfo <-
    if fsFile
      then liftIO $ Ae.eitherDecodeFileStrict' genesisFilename
      else return $ do
        contents <- maybe (Left "file not found") Right $ lookup genesisFilename genesisFiles
        Ae.eitherDecodeStrict' contents
  case (eGenInfo :: Either String GenesisInfo) of
    Left err -> liftIO $ die err
    Right genInfo -> do
      let blockFile = "Genesis.json"
      liftIO $ Ae.encodeFile blockFile genInfo
      liftIO $ makeReadOnly blockFile

sendAccountInfo :: (MonadMask m, HasKafka m) =>
                   FilePath -> m ()
sendAccountInfo accountInfoFileName = do
  fsFile <- doesFileExist accountInfoFileName
  if fsFile
    then do
      let sendChunks :: HasKafka m => Handle -> m ()
          sendChunks h = do
            acs <- liftIO $ TIO.hGetChunk h
            unless (T.null acs) $ do

              let accountFile = "AccountInfo"
              liftIO $ TIO.appendFile accountFile acs

              sendChunks h
      bracket (openFile accountInfoFileName ReadMode) hClose $ \h -> do
        hSetBuffering h (BlockBuffering (Just (1024 * 1024)))
        sendChunks h
    else case lookup accountInfoFileName genesisFiles of
      Nothing -> liftIO $ putStrLn "No account info found, assuming it isn't needed"
      Just acs -> do
          let accountFile = "AccountInfo"
          liftIO $ TIO.appendFile accountFile $ decodeUtf8 acs

makeReadOnly :: FilePath -> IO ()
makeReadOnly = void . chmod roo
