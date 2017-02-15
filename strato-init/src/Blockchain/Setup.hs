{-# LANGUAGE OverloadedStrings, TypeSynonymInstances, FlexibleInstances, FlexibleContexts #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Setup (
  oneTimeSetup
  ) where

import Control.Concurrent
import Control.Monad
import Control.Monad.IO.Class
import Control.Monad.Logger
import Control.Monad.Trans.Reader
import Control.Monad.Trans.Resource
import Control.Monad.Trans.State
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as C
import Data.FileEmbed
import Data.String
import qualified Database.LevelDB as DB
import Database.Persist.Postgresql hiding (get)
import System.Directory
import System.FilePath
import Data.Maybe
-- import Data.Aeson
import Data.Yaml
import qualified Data.Map as Map
import qualified Data.Text as T
import Network.Kafka
import Network.Kafka.Protocol
import System.Entropy

--import Paths_strato_init

import Blockchain.APIFiles
import qualified Blockchain.Colors as CL
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.Data.Blockchain
import Blockchain.Data.DataDefs
import Blockchain.Data.GenesisBlock
import Blockchain.DB.CodeDB
import Blockchain.DB.HashDB
import Blockchain.DB.StateDB
import Blockchain.DB.SQLDB
import Blockchain.Constants
import Blockchain.EthConf
import Blockchain.PrivateKeyConf
import Blockchain.KafkaTopics
import Blockchain.Output

import qualified Executable.EthDiscoverySetup as EthDiscovery

import HFlags 

defineFlag "u:pguser" ("" :: String) "Postgres user"
defineFlag "P:pghost" ("" :: String) "Postgres hostname"
defineFlag "p:password" ("" :: String) "Postgres password"
defineFlag "K:kafkahost" ("" :: String) "Kafka hostname"
defineFlag "z:zkhost" ("localhost" :: String) "Zookeeper hostname"
defineFlag "z:lazyblocks" (False :: Bool) "Don't mine empty blocks"
defineFlag "backupmp" False "backup the MP database from STDIN"
defineFlag "backupblocks" False "backup the block DB from STDIN"
defineFlag "addBootnodes" True "Adds bootnodes to the peer DB at setup time.  If set to false, the peer will not be able to initiate a connection to the network by itself (this option is useful if you want to set up a peer to itself be a bootnode in a private network)"
defineFlag "stratoBootnode" ("" :: String) "Replaces the default set of public boot nodes with the provided ip address, considered as the address of a strato node"
defineFlag "blockTime" (13 :: Integer) "Blocktime"
defineFlag "minBlockDifficulty" (131072 :: Integer) "Minimum block difficulty"
defineFlag "R:redisHost" ("localhost" :: String) "Redis BlockDB hostname"
defineFlag "redisPort" (6379 :: Int) "Redis BlockDB port"

data SetupDBs =
  SetupDBs {
    stateDB::StateDB,
    hashDB::HashDB,
    codeDB::CodeDB,
    sqlDB::SQLDB
    }

type SetupDBM = StateT SetupDBs (ResourceT IO)
instance HasStateDB SetupDBM where
  getStateDB = do
    cxt <- get
    return $ stateDB cxt
  setStateDBStateRoot sr = do
    cxt <- get
    put cxt{stateDB=(stateDB cxt){MP.stateRoot=sr}}

{-instance HasStorageDB SetupDBM where
  getStorageDB = do
    cxt <- get
    return $ MPDB.ldb $ setupDBStateDB cxt --storage and states use the same database!-}

instance HasHashDB SetupDBM where
  getHashDB = fmap hashDB get

instance HasCodeDB SetupDBM where
  getCodeDB = fmap codeDB get

instance HasSQLDB SetupDBM where
  getSQLDB = fmap sqlDB get

{-
connStr::ConnectionString
connStr = "host=localhost dbname=eth user=postgres password=api port=5432"
-}

defaultSqlConfig :: SqlConf
defaultSqlConfig = 
    SqlConf {
      user = "postgres",
      password = "api",
      host = "localhost",
      port = 5432,
      database = "eth",
      poolsize = 10
    } 

defaultKafkaConfig :: KafkaConf
defaultKafkaConfig = KafkaConf {
  kafkaHost = "localhost",
  kafkaPort = 9092
  }

defaultLevelDBConfig :: LevelDBConf
defaultLevelDBConfig =
    LevelDBConf { 
      table = "",
      path = ""
    }

defaultBlockConfig :: BlockConf
defaultBlockConfig = 
    BlockConf {
      blockTime = 13,
      minBlockDifficulty = 131072
    }

defaultPrivKey :: PrivKey
defaultPrivKey = PrivKey 0

defaultEthUniqueId :: EthUniqueId
defaultEthUniqueId = 
    EthUniqueId {
      peerId = "",
      genesisHash = "",
      networkId = 0  
    } 

defaultQuarryConfig :: QuarryConf
defaultQuarryConfig = 
    QuarryConf { 
      coinbaseAddress = "ab",
      lazyBlocks = False
    }

defaultGeneralConfig :: GeneralConf
defaultGeneralConfig = 
    GeneralConf { 
      fastECRecover = True
    }

defaultDiscoveryConfig :: DiscoveryConf
defaultDiscoveryConfig = 
    DiscoveryConf {
      discoveryPort=30303,
      minAvailablePeers=100
    }

defaultRedisBlockDBConfig :: RedisBlockDBConf
defaultRedisBlockDBConfig = RedisBlockDBConf {
    redisHost           = flags_redisHost,
    redisPort           = flags_redisPort,
    redisAuth           = Nothing,
    redisDBNumber       = 0,
    redisMaxConnections = 10,
    redisMaxIdleTime    = 30
    }

defaultConfig :: EthConf
defaultConfig = 
    EthConf { 
      ethUniqueId        = defaultEthUniqueId,
      privKey            = defaultPrivKey,
      sqlConfig          = defaultSqlConfig,
      redisBlockDBConfig = defaultRedisBlockDBConfig,
      levelDBConfig      = defaultLevelDBConfig,
      kafkaConfig        = defaultKafkaConfig,
      blockConfig        = defaultBlockConfig,
      quarryConfig       = defaultQuarryConfig,
      discoveryConfig    = defaultDiscoveryConfig,
      generalConfig      = defaultGeneralConfig
    }
                   
defaultPeers::[(String,Int)]
defaultPeers = 
  [
    ("127.0.0.1" ,30303),
    ("10.0.0.2" ,30303),
    ("10.0.0.3" ,30303),
    ("10.0.0.101" ,30303),
    ("poc-9.ethdev.com" ,30303),
    ("poc-8.ethdev.com" ,30303),
    ("api.blockapps.net" ,30303),
    ("stablenet.blockapps.net" ,30303),
    ("gav.ethdev.com" ,30303),
    ("52.5.60.7" ,30303),
    ("52.4.40.229" ,30303),
    ("52.4.180.23" ,30303),
    ("52.4.131.128" ,30303),
    ("52.16.188.185" ,30303),
    ("52.0.243.36" ,30303),
    ("92.51.165.126" ,30303),
    ("144.76.62.101" ,30303),
    ("52.5.26.21" ,30303),
    ("52.5.26.15" ,30303),
    ("52.5.25.137" ,30303),
    ("54.207.93.166" ,30303),
    ("207.12.89.180" ,30303),
    ("24.90.136.85" ,40404), 
    ("185.43.109.23" ,30303),
    ("76.220.27.23" ,30303),
    ("194.151.205.61" ,30303),
    ("104.236.44.20" ,30303),
    ("90.215.69.132" ,30303),
    ("46.115.170.122" ,30303),
    ("82.113.99.187" ,30303),
    ("54.73.114.158" ,30303),
    ("94.197.120.233" ,30303),
    ("99.36.164.218" ,30301),
    ("79.205.230.196" ,30303),
    ("213.61.84.226" ,30303),
    ("82.217.72.169" ,20818),
    ("66.91.18.59" ,30303),
    ("92.225.49.139" ,30303),
    ("46.126.19.53" ,30303),
    ("209.6.197.196" ,30303),
    ("95.91.196.230" ,30303),
    ("77.87.49.7" ,30303),
    ("77.50.138.143" ,22228),
    ("84.232.211.95" ,30300),
    ("213.127.159.150" ,30303),
    ("89.71.42.180" ,30303),
    ("216.240.30.23" ,30303),
    ("62.163.114.115" ,30304),
    ("178.198.11.18" ,30303),
    ("94.117.148.121" ,30303),
    ("80.185.182.157" ,30303),
    ("129.194.71.126" ,30303),
    ("129.194.71.126" ,12667),
    ("199.254.238.167" ,30303),
    ("71.208.244.211" ,30303),
    ("46.114.45.182" ,30303),
    ("178.37.149.29" ,30303),
    ("81.38.156.153" ,30303),
    ("5.144.60.120" ,30304),
    ("67.188.113.229" ,30303),
    ("23.121.237.24" ,30303),
    ("37.120.31.241" ,30303),
    ("79.178.55.18" ,30303),
    ("50.1.116.44" ,30303),
    ("213.129.230.10" ,30303),
    ("91.64.116.234" ,30303),
    ("86.164.51.215" ,30303),
    ("46.127.142.224" ,30300),
    ("195.221.66.4" ,30300),
    ("95.90.239.241" ,30303),
    ("176.67.169.137" ,30303),
    ("94.224.199.123" ,30303),
    ("38.117.159.162" ,30303),
    ("5.9.141.240" ,30303),
    ("110.164.236.93" ,30303),
    ("86.147.58.164" ,30303),
    ("188.63.78.132" ,30303),
    ("128.12.255.172" ,30303),
    ("90.35.135.242" ,30303),
    ("82.232.60.209" ,30303),
    ("87.215.30.74" ,30303),
    ("129.194.81.234" ,22318),
    ("178.19.221.38" ,30303),
    ("94.174.162.250" ,30303),
    ("193.138.219.234" ,30303),
    ("188.122.16.76" ,30303),
    ("71.237.182.164" ,30303),
    ("207.12.89.180" ,30303),
    ("207.12.89.180" ,30300),
    ("84.72.161.78" ,30303),
    ("173.238.50.70" ,30303),
    ("90.213.167.21" ,30303),
    ("120.148.4.242" ,30303),
    ("67.237.187.247" ,30303),
    ("77.101.50.246" ,30303),
    ("88.168.242.87" ,30300),
    ("40.141.47.2" ,30303),
    ("109.201.154.150" ,30303),
    ("5.228.251.149" ,30303),
    ("79.205.244.3" ,30303),
    ("77.129.6.180" ,30303),
    ("208.52.154.136" ,30300),
    ("199.254.238.167" ,30303),
    ("80.185.170.70" ,30303),
    ("188.220.9.241" ,30303),
    ("129.194.81.234" ,30303),
    ("76.100.20.104" ,30300),
    ("162.210.197.234" ,30303),
    ("89.246.69.218" ,30303),
    ("178.19.221.38" ,29341),
    ("217.91.252.61" ,30303),
    ("118.241.70.83" ,30303),
    ("190.17.13.160" ,30303),
    ("68.7.46.39" ,30303),
    ("99.36.164.218" ,30301),
    ("37.157.38.10" ,30303),
    ("24.176.161.133" ,30303),
    ("82.113.99.187" ,30303),
    ("194.151.205.61" ,30303),
    ("54.235.157.173" ,30303),
    ("95.91.210.151" ,10101),
    ("108.59.8.182" ,30303),
    ("217.247.70.175" ,30303),
    ("173.238.52.23" ,30303),
    ("82.217.72.169" ,30304),
    ("176.114.249.240" ,30303),
    ("178.19.221.38" ,10101),
    ("87.149.174.176" ,990),
    ("95.90.239.67" ,30300),
    ("77.129.3.69" ,30303),
    ("88.116.98.234" ,30303),
    ("216.164.146.72" ,22880),
    ("107.170.255.207" ,30303),
    ("178.62.221.246" ,30303),
    ("177.205.165.56" ,30303),
    ("115.188.14.179" ,112),
    ("145.129.59.101" ,30303),
    ("64.134.53.142" ,30303),
    ("68.142.28.137" ,30303),
    ("162.243.131.173" ,30303),
    ("81.181.146.231" ,30303),
    ("23.22.211.45" ,30303),
    ("24.134.75.192" ,30303),
    ("188.63.251.204" ,30303),
    ("93.159.121.155" ,30303),
    ("109.20.132.214" ,30303),
    ("204.50.102.246" ,30303),
    ("50.245.145.217" ,30303),
    ("86.143.179.69" ,30303),
    ("77.50.138.143" ,22228),
    ("23.22.211.45" ,992),
    ("65.206.95.146" ,30303),
    ("68.60.166.58" ,30303),
    ("178.198.215.3" ,30303),
    ("64.134.58.80" ,30303),
    ("207.229.173.166" ,30303),
    ("kobigurk.dyndns.org",30303),
    ("37.142.103.9" ,30303) ]

createKafkaTopic :: TopicName -> IO () 
createKafkaTopic topic = do
  result <- runKafka (mkKafkaState "strato-setup" (fromString flags_kafkahost, 9092)) $ updateMetadata topic
  case result of
   Left err -> error $ "error connecting to kafka at host '" ++ flags_kafkahost ++ "': " ++ show err
   _ -> return ()
  
topics :: [String]
topics = [ "unminedblock"
         , "statediff"
         , "seqevents"
         , "unseqevents"
         , "jsonrpcresponse"
         , "ranblocks"
         ]

genesisFiles::[(FilePath, B.ByteString)]
genesisFiles = $(embedDir "genesisBlocks")

addStandardGenesisBlockIfNeeded::String->IO ()
addStandardGenesisBlockIfNeeded genesisBlockName = do
  let genesisFileName = genesisBlockName ++ "Genesis.json"

      maybeContents = lookup genesisFileName genesisFiles
  
  exists <- doesFileExist genesisFileName

  case (exists, maybeContents) of
   (True, _) -> return ()
   (_, Just contents) -> B.writeFile genesisFileName contents
   _ -> error $ "Search for genesis file has failed.  You need to supply a file named '" ++ genesisFileName ++ "'"

{-
  CONFIG: 

  oneTimeSetup now creates .ethereumH and moves config files into it.
  It then creates the databases namespaced by UUIDs. We could probably use local paths here,
  but those strings might get annoyingly long. 

  To be safe, this operation should be idempotent. Thus we check for the presence of ~/.ethereumH.

  Preconditions: installed LevelDB, Postgres, Kafka.
-}

oneTimeSetup :: String -> IO ()
oneTimeSetup genesisBlockName = do
  dirExists <- doesDirectoryExist ".ethereumH"

  if dirExists
    then do  
        putStrLn ".ethereumH exists, unsafe to run setup"
        return ()
    else do  

     {- CONFIG create default config files -} 

      addStandardGenesisBlockIfNeeded genesisBlockName
    
      putStrLn "writing config"

      maybePGuser <- case flags_pguser of
             "" -> do putStrLn "using default postgres user: postgres"
                      return (Just "postgres")
             user' -> return (Just user')

      maybePGhost <- case flags_pghost of
             "" -> do putStrLn "using default postgres host: localhost"
                      return (Just "localhost")
             host' -> return (Just host')

      maybePGpass <- case flags_password of
             "" -> error "specify password for postgres user: "
             pass -> return (Just pass)

      kafkaHostFlag <- case flags_kafkahost of
             "" -> do putStrLn "using default kafka host: localhost"
                      return "localhost"
             host' -> return host'

      bytes <- getEntropy 20

      createDirectoryIfMissing True $ dbDir "h"



      let user'' =  case maybePGuser of 
                        Nothing -> "postgres"
                        Just "" -> "postgres"
                        Just usr -> usr

          cfg = defaultConfig { 
                    sqlConfig = defaultSqlConfig {
                        user     = user'',
                        host     = fromMaybe "localhost" maybePGhost,
                        password = fromMaybe "" maybePGpass
                    },
                    blockConfig = defaultBlockConfig {
                        blockTime          = flags_blockTime,
                        minBlockDifficulty = flags_minBlockDifficulty
                    },
                    quarryConfig = defaultQuarryConfig {
                        lazyBlocks = flags_lazyblocks
                    }
                }

     {- CONFIG: create database and write default config files, including strato-api -}
     
      randomPrivKey <- generatePrivKey
      let uniqueString = C.unpack . B16.encode $ bytes 
          pgCfg = sqlConfig cfg
          pgCfg' = pgCfg { database = "" } 
          db = database pgCfg
          db' = db ++ "_" ++ uniqueString
          pgCfg'' = pgCfg { database = db' }
          pgConn' = postgreSQLConnectionString pgCfg'
          pgConnGlobal = postgreSQLConnectionString pgCfg { database = "blockchain" }
          kafkaCfg = defaultKafkaConfig { kafkaHost = kafkaHostFlag }

          cfg' = cfg { 
                   privKey = randomPrivKey,
                   sqlConfig = pgCfg'', 
                   kafkaConfig = kafkaCfg,
                   ethUniqueId = defaultEthUniqueId {
                     peerId = uniqueString
                   }
                 }

      inflateDir stratoAPICerts
      inflateDir stratoAPIStaticDir
      inflateDir stratoAPIConfigDir

      putStrLn $ CL.red "WARNING: the private key for this strato node is being written to the file .ethereumH/ethconf.yaml.  Please keep it secure; anyone who reads it will become you."
      encodeFile (".ethereumH" </> "ethconf.yaml") cfg'
      encodeFile (".ethereumH" </> "peers.yaml") defaultPeers

      {- CONFIG: register this blockchain with the global database -}

      currPath <- getCurrentDirectory

      _ <- insertBlockchain pgConnGlobal currPath uniqueString

      encodeFile (".ethereumH" </> "ethconf.yaml") cfg'
      encodeFile (".ethereumH" </> "peers.yaml") defaultPeers

      {- CONFIG: Create the local database -}

      liftIO $ putStrLn $ CL.yellow ">>>> Creating Database " ++ db'
      liftIO $ putStrLn $ CL.blue $ "  connection is " ++ show pgConn'

      let query = T.pack $ "CREATE DATABASE " ++ show db' ++ ";"

      runNoLoggingT $ withPostgresqlConn pgConn' $ runReaderT $ rawExecute query []

      {- CONFIG: create kafka topics -} 

      let uniqueTopicMap = Map.fromList [(topic, topic ++ "_" ++ uniqueString) | topic <- topics]
      encodeFile (".ethereumH" </> "topics.yaml") uniqueTopicMap

    {- kafkaTopics implicitly defined by ethconf.yaml above & unsafePerformIO -}

      forM_ kafkaTopics $ createKafkaTopic . fromString
  
      liftIO $ threadDelay 1000000 --Kafka needs this delay after creating topics!  Without this, when we send a message the program will crash for a short duration.  The choice of 1 second is empirically determined, if we are unlucky the number may need to be higher on other machines.

     {- CONFIG: define tables and indices -}
     {- connStr implicitly defined by ethconf.yaml above, & unsafePerformIO -}  
     
      runNoLoggingT $ withPostgresqlConn connStr $ runReaderT $ do
         liftIO $ putStrLn $ CL.yellow ">>>> Migrating SQL DB"
         liftIO $ putStrLn $ CL.blue $ "  connection is " ++ show connStr

         _ <- runMigrationSilent migrateAll

         liftIO $ putStrLn $ CL.yellow ">>>> Creating SQL Indexes"
         rawExecute "CREATE INDEX CONCURRENTLY ON block_data_ref (block_id);" []
         rawExecute "CREATE INDEX CONCURRENTLY ON block_data_ref (number);" []
         rawExecute "CREATE INDEX CONCURRENTLY ON block_data_ref (hash);" []
         rawExecute "CREATE INDEX CONCURRENTLY ON block_data_ref (parent_hash);" []
         rawExecute "CREATE INDEX CONCURRENTLY ON block_data_ref (coinbase);" []
         rawExecute "CREATE INDEX CONCURRENTLY ON block_data_ref (total_difficulty);" []

         rawExecute "CREATE INDEX CONCURRENTLY ON address_state_ref (address);" []

         rawExecute "CREATE INDEX CONCURRENTLY ON raw_transaction (from_address);" []
         rawExecute "CREATE INDEX CONCURRENTLY ON raw_transaction (to_address);" []
         rawExecute "CREATE INDEX CONCURRENTLY ON raw_transaction (block_number);" [] 
         rawExecute "CREATE INDEX CONCURRENTLY ON raw_transaction (tx_hash);" [] 

         rawExecute "CREATE INDEX CONCURRENTLY ON storage (key);" []

         rawExecute "CREATE INDEX CONCURRENTLY ON transaction_result (transaction_hash);" []

     {- create directory and dbs -} 
      _ <-
          runResourceT $ do
              liftIO $ putStrLn $ CL.yellow ">>>> Setting UP DB handles"

          {- CONFIG: localized -}

              sdb <- DB.open (dbDir "h" ++ stateDBPath)
                     DB.defaultOptions{DB.createIfMissing=True, DB.cacheSize=1024}
              hdb <- DB.open (dbDir "h" ++ hashDBPath)
                     DB.defaultOptions{DB.createIfMissing=True, DB.cacheSize=1024}
              cdb <- DB.open (dbDir "h" ++ codeDBPath)
                     DB.defaultOptions{DB.createIfMissing=True, DB.cacheSize=1024}
              let smpdb = MP.MPDB{MP.ldb=sdb, MP.stateRoot=error "stateRoot not defined in oneTimeSetup"}

              pool <- runNoLoggingT $ createPostgresqlPool connStr 20

              _ <- flip runStateT (SetupDBs smpdb hdb cdb pool) $ do
                addCode B.empty --blank code is the default for Accounts, but gets added nowhere else.
                liftIO $ putStrLn $ CL.yellow ">>>> Initializing Genesis Block"
                case (flags_backupmp, flags_backupblocks) of
                  (False, False) -> initializeGenesisBlock NoBackup genesisBlockName
                  (True, True) -> error "You can't choose --backupmp and --backupblocks at the same time"
                  (False, True) -> initializeGenesisBlock BlockBackup genesisBlockName
                  (True, False) -> initializeGenesisBlock MPBackup genesisBlockName

              return ()

     {- create Kafka topics -} 

      let bootnodes = case (flags_addBootnodes, flags_stratoBootnode) of
                        (False, _) -> Nothing
                        (True, "") -> Just []
                        (True, ipAddr) -> Just [ipAddr]
      flip runLoggingT printLogMsg $ EthDiscovery.setup bootnodes

      return ()

                    

