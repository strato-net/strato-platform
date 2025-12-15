{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE NumericUnderscores #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Init.Generator (
  createGenesisInfo,
  mkAll
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
import Blockchain.Init.Options
import qualified Blockchain.Network as Net
import Blockchain.Strato.Model.Options (flags_network)
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
import qualified Data.Map as M
import qualified Data.Yaml as YAML
import Database.Persist.Postgresql
import qualified Executable.EthDiscoverySetup as EthDiscovery
import System.FilePath ((</>))
import Text.RawString.QQ
import Turtle (chmod, roo)
import UnliftIO.Directory

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
          _ -> HELIUM.genesisBlock

  liftIO $ B.writeFile "genesis.json" . BL.toStrict $ JSON.encode genesisInfo
  liftIO $ putStrLn $ "Done. Output genesis block info was written"

createCommandsFile :: IO ()
createCommandsFile =
  writeFile "commands.txt" [r|ethereum-discover +RTS -T -RTS

strato-p2p --averageTxsPerBlock=40 --connectionTimeout=3600 --debugFail=true --maxConn=1000 --maxReturnedHeaders=500 --networkID=-1 --sqlPeers=true --minLogLevel=LevelInfo --network=helium +RTS -T -RTS

strato-sequencer --blockstanbul_block_period_ms=1000 --blockstanbul_round_period_s=120 --minLogLevel=LevelInfo --seq_max_events_per_iter=500 --seq_max_us_per_iter=50000 --validatorBehavior=true --test_mode_bypass_blockstanbul=false --network=helium +RTS -T -RTS +RTS -N1

vm-runner --blockstanbul=true --debug=false --debugEnabled=false --debugPort=8051 --debugWSHost=strato --debugWSPort=8052 --diffPublish=true --maxTxsPerBlock=500 --minLogLevel=LevelInfo --networkID=-1 --seqEventsBatchSize=-1 --seqEventsCostHeuristic=20000 --sqlDiff=true --svmDev=false --svmTrace=false --network=helium +RTS -T -RTS +RTS -I2 -N1

strato-p2p-indexer

strato-api-indexer

slipstream --database=cirrus --kafkahost=localhost --kafkaport=9092 --minLogLevel=LevelInfo --pghost=localhost --pgport=5432 --pguser=postgres --password=api --stratourl=http://localhost:3000/eth/v1.2 +RTS -T -RTS

strato-api --minLogLevel=LevelInfo --networkID=-1 --vaultUrl=https://vault.blockapps.net:8093 --oauthDiscoveryUrl=https://keycloak.blockapps.net/auth/realms/mercata/.well-known/openid-configuration --network=helium +RTS -T -RTS +RTS -N1

strato-network-monitor
|]



mkAll :: (MonadLoggerIO m, MonadUnliftIO m, MonadFail m, HasKafka m) =>
         String -> m ()
mkAll network = do
  ethconf <- liftIO genEthConf

  let dir = ".ethereumH"
  liftIO $ createDirectoryIfMissing True dir
  liftIO $ YAML.encodeFile (dir </> "ethconf.yaml") ethconf
  liftIO $ makeReadOnly $ dir </> "ethconf.yaml"

  genesisExists <- doesFileExist "genesis.json"

  if genesisExists
    then do
      $logInfoS "mkAll" "Using provided 'genesis.json'"
      return ()
    else do
      $logInfoS "mkAll" "Creating 'genesis.json' using network name"
      createGenesisInfo network

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

  liftIO createCommandsFile

  runResourceT . runSetupDBM . runRedisM UEC.lookupRedisBlockDBConfig . runSQLM $ do
    $logInfoS "runWorker" "Adding empty code"
    void $ addCode mempty -- blank code is the default for Accounts, but gets added nowhere else.
    $logInfoS "runWorker" "Processing genesis block"
    initializeGenesisBlock
    $logInfoS "runWorker" "done. here I am once again"

makeReadOnly :: FilePath -> IO ()
makeReadOnly = void . chmod roo
