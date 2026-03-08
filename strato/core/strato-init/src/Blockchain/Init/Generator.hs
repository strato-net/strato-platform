{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE NumericUnderscores #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Init.Generator (
  createGenesisInfo,
  mkAll,
  mkFiles,
  mkDatabases
  ) where

import BlockApps.Logging
import qualified Blockchain.Data.DataDefs as DataDefs
import qualified Blockchain.EthConf as UEC
import qualified Blockchain.EthConf.Model as EC
import Blockchain.DB.CodeDB
import Blockchain.GenesisBlock
import Blockchain.Init.EthConf
import Blockchain.GenesisBlocks.HeliumGenesisBlock as HELIUM
import Blockchain.Init.Monad
import Blockchain.Strato.Model.Validator
import Conduit
import Control.Monad
import Control.Monad.Change.Alter ()
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
import qualified Data.Yaml as YAML
import Database.Persist.Postgresql
import System.FilePath ((</>))
import System.Random (randomRIO)
import Text.RawString.QQ
import Turtle (chmod, roo)
import UnliftIO.Directory
import UnliftIO.Exception (catch, SomeException)

createGenesisInfo :: MonadIO m => String -> m ()
createGenesisInfo network = do
  let genesisInfo =
        case network of
          "upquark" -> HELIUM.genesisBlockTemplate config
            where config = HELIUM.HeliumGenesisBlockConfig
                    upquarkValidators
                    upquarkAdmins
                    HELIUM.blockappsProdAddress
                    []
                    []
                    upquarkBridgeRelayer
                    upquarkOracleRelayers
                  upquarkValidators = -- TODO: move this to a more logical place
                    [ Validator 0x2e8462e383a1d516cfbf13d7cf4826ce77b4b91e
                    , Validator 0x3e7b7d721cf9a4ec9f7c87a6c02572bb7ef1bbf4
                    , Validator 0x4d8cb07af178cb10db093abea710b73179a5dd16
                    , Validator 0x4dd4bb6125cefd36d5adfbb303d8f00787b7ea0c
                    ]
                  upquarkAdmins =
                    [ 0x7630b673862a2807583834908f10192e00c58b00 --Kieren
                    , 0x292dd9591f506845ef05a9f3b8116e641cbcb4bb --Victor
                    , 0xf1ba16a6cfb2a17fb34ad477eaaf0c76eac64f14 --Jamshid
                    ]
                  upquarkBridgeRelayer =
                    (0x882f3d3a7b97ea24ab5aeae6996a695b26ea9089, 100_000 * HELIUM.oneE18)
                  upquarkOracleRelayers =
                    [ (0x96714c4a2163a3ee55356e20bc23fe8ea5e7aaf0, 100_000 * HELIUM.oneE18)
                    , (0x523fef378674d39363aa8b6ac5122e301c528432, 100_000 * HELIUM.oneE18)
                    ]
          "lithium" -> HELIUM.lithiumGenesisBlock
          _ -> HELIUM.genesisBlock

  liftIO $ B.writeFile "genesis.json" . BL.toStrict $ JSON.encode genesisInfo
  liftIO $ putStrLn $ "Done. Output genesis block info was written"

createCommandsFile :: IO ()
createCommandsFile =
  writeFile "commands.txt" [r|ethereum-discover +RTS -T -RTS

strato-p2p +RTS -T -RTS

strato-sequencer +RTS -T -N1 -RTS

vm-runner --debugWSHost=strato --diffPublish=true +RTS -T -I2 -N1 -RTS

strato-p2p-indexer

strato-api-indexer

slipstream +RTS -T -RTS

strato-api +RTS -T -N1 -RTS

strato-network-monitor
|]



mkFiles :: (MonadLoggerIO m, MonadFail m) =>
           String -> m ()
mkFiles network = do
  -- Create node directories first (needed before genEthConf reads postgres_password)
  liftIO $ mapM_ (createDirectoryIfMissing True)
    ["postgres", "redis", "kafka", "prometheus", "logs", "secrets", ".ethereumH"]

  -- Generate random postgres password (needed by genEthConf)
  let pgPasswordFile = "secrets" </> "postgres_password"
  pgPasswordExists <- doesFileExist pgPasswordFile
  unless pgPasswordExists $ liftIO $ do
    password <- generatePassword 32
    writeFile pgPasswordFile password
    void $ chmod roo pgPasswordFile

  ethconf <- liftIO genEthConf

  let dir = ".ethereumH"
  liftIO $ YAML.encodeFile (dir </> "ethconf.yaml") ethconf
  liftIO $ makeReadOnly $ dir </> "ethconf.yaml"

  liftIO $ do
    nodeDir <- getCurrentDirectory
    home <- getHomeDirectory
    let stratoDir = home </> ".strato"
        defaultNodeFile = stratoDir </> "default-node"
    createDirectoryIfMissing True stratoDir
    writeFile defaultNodeFile nodeDir
    putStrLn $ "Set default node directory: " ++ nodeDir

  genesisExists <- doesFileExist "genesis.json"

  if genesisExists
    then do
      $logInfoS "mkFiles" "Using provided 'genesis.json'"
      return ()
    else do
      $logInfoS "mkFiles" "Creating 'genesis.json' using network name"
      createGenesisInfo network

  liftIO createCommandsFile
  $logInfoS "mkFiles" "File setup complete"

mkDatabases :: (MonadLoggerIO m, MonadUnliftIO m, MonadFail m, HasKafka m) =>
               m ()
mkDatabases = do
  -- Read ethconf from file (created by strato-setup)
  let ethconf = UEC.ethConf

  let pgconf = EC.sqlConfig ethconf
      rawConn = EC.postgreSQLConnectionString pgconf {EC.database = ""}
      localConn = EC.postgreSQLConnectionString pgconf
      db = EC.database pgconf
  $logInfoS "mkDatabases/Create Database" . T.pack $ CL.yellow db
  $logInfoLS "mkDatabases/Create Database" rawConn
  let query = T.pack $ "CREATE DATABASE " ++ show db ++ ";"

  catch
    (withPostgresqlConn rawConn (runReaderT (rawExecute query [])))
    (\(_ :: SomeException) -> $logInfoS "mkDatabases/Create Database" "Database already exists, skipping")

  withPostgresqlConn localConn $
    runReaderT $ do
      $logInfoS "mkDatabases/migrate" . T.pack $ CL.yellow ">>>> Migrating eth"
      $logInfoLS "mkDatabases/migrateconn" localConn
      runMigration DataDefs.migrateAll
      $logInfoS "mkDatabases/migrate" . T.pack $ CL.yellow ">>>> Indexing eth"
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

  runResourceT . runSetupDBM . runRedisM UEC.lookupRedisBlockDBConfig . runSQLM $ do
    $logInfoS "mkDatabases" "Adding empty code"
    void $ addCode mempty
    $logInfoS "mkDatabases" "Processing genesis block"
    initializeGenesisBlock
    $logInfoS "mkDatabases" "Database setup complete"

mkAll :: (MonadLoggerIO m, MonadUnliftIO m, MonadFail m, HasKafka m) =>
         String -> m ()
mkAll network = do
  mkFiles network
  mkDatabases

makeReadOnly :: FilePath -> IO ()
makeReadOnly = void . chmod roo

generatePassword :: Int -> IO String
generatePassword len = mapM (const randomChar) [1..len]
  where
    chars = ['a'..'z'] ++ ['A'..'Z'] ++ ['0'..'9']
    randomChar = do
      idx <- randomRIO (0, length chars - 1)
      return $ chars !! idx
