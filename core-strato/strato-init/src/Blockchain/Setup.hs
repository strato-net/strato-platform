{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE LambdaCase            #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# LANGUAGE TypeOperators         #-}
{-# LANGUAGE TypeSynonymInstances  #-}

module Blockchain.Setup (
  oneTimeSetup
  ) where

import           Control.Concurrent
import           Control.Monad
import qualified Control.Monad.Change.Alter         as A
import qualified Control.Monad.Change.Modify        as Mod
import           Control.Monad.IO.Class
import           Control.Monad.Trans.Reader
import           Control.Monad.Trans.Resource
import qualified Data.Aeson                         as Ae
import qualified Data.ByteString                    as B
import qualified Data.ByteString.Base16             as B16
import qualified Data.ByteString.Char8              as C
import           Data.FileEmbed
import           Data.IORef
import           Data.List.Split                    (splitWhen)
import qualified Data.Map                           as Map
import           Data.Maybe
import qualified Data.NibbleString                  as N
import           Data.String
import qualified Data.Text                          as T
import           Data.Yaml
import qualified Database.LevelDB                   as DB
import           Database.Persist.Postgresql        hiding (get)
import qualified Database.Redis                     as Redis hiding (get)
import           Network.Kafka
import           Network.Kafka.Protocol
import           System.Directory
import           System.Entropy
import           System.FilePath

import           Blockchain.APIFiles
import           Blockchain.Constants
import           Blockchain.Data.AddressStateDB
import           Blockchain.Data.Blockchain         as Blockchain
import qualified Blockchain.Data.DataDefs           as DataDefs
import           Blockchain.GenesisBlock
import qualified Blockchain.Database.MerklePatricia as MP
import           Blockchain.DB.CodeDB
import           Blockchain.DB.HashDB
import           Blockchain.DB.MemAddressStateDB
import           Blockchain.DB.RawStorageDB
import           Blockchain.DB.SQLDB
import           Blockchain.DB.StateDB
import           Blockchain.EthConf
import           Blockchain.KafkaTopics
import           Blockchain.Output
import           Blockchain.PrivateKeyConf
import           Blockchain.SHA
import qualified Blockchain.Strato.RedisBlockDB     as RBDB
import           Blockchain.Strato.Model.Address

import qualified Executable.EthDiscoverySetup       as EthDiscovery

import qualified Text.Colors                        as CL

import           HFlags

defineFlag "u:pguser" (""  ::  String) "Postgres user"
defineFlag "P:pghost" (""  ::  String) "Postgres hostname"
defineFlag "p:password" (""  ::  String) "Postgres password"
defineFlag "K:kafkahost" (""  ::  String) "Kafka hostname"
defineFlag "z:zkhost" ("localhost"  ::  String) "Zookeeper hostname"
defineFlag "z:lazyblocks" (False  ::  Bool) "Don't mine empty blocks"
defineFlag "backupmp" False "backup the MP database from STDIN"
defineFlag "backupblocks" False "backup the block DB from STDIN"
defineFlag "addBootnodes" True "Adds bootnodes to the peer DB at setup time.  If set to false, the peer will not be able to initiate a connection to the network by itself (this option is useful if you want to set up a peer to itself be a bootnode in a private network)"
defineCustomFlag "stratoBootnode" [| []  ::  [String] |] "STRING_LIST"
     [| \s -> if any (==',') s then splitWhen (==',') s else [s] |]
  [| show |]
  "Replaces the default set of public boot nodes with the provided ip address(es), considered as the address of a strato node(s)"

defineFlag "blockTime" (13  ::  Integer) "Blocktime"
defineFlag "minBlockDifficulty" (131072  ::  Integer) "Minimum block difficulty"
defineFlag "R:redisHost" ("localhost"  ::  String) "Redis BlockDB hostname"
defineFlag "redisPort" (6379  ::  Int) "Redis BlockDB port"
defineFlag "redisDBNumber" (0  ::  Integer) "Redis database number"

defineFlag "extraFaucets" ("[]" :: String) "JSON encoded list of other faucets to initialize"

data SetupDBs =
  SetupDBs {
    stateDB :: StateDB,
    stateRoot :: IORef MP.StateRoot,
    hashDB  :: HashDB,
    codeDB  :: CodeDB,
    sqlDB   :: SQLDB,
    redisDB :: RBDB.RedisConnection,
    localStorageTx :: IORef (Map.Map RawStorageKey RawStorageValue),
    localStorageBlock :: IORef (Map.Map RawStorageKey RawStorageValue),
    localAddressStateTx :: IORef (Map.Map Address AddressStateModification),
    localAddressStateBlock :: IORef (Map.Map Address AddressStateModification)
    }

type SetupDBM = ReaderT SetupDBs (LoggingT (ResourceT IO))

instance Mod.Modifiable MP.StateRoot SetupDBM where
  get _    = liftIO . readIORef =<< asks stateRoot
  put _ sr = do
    srRef <- asks stateRoot
    liftIO $ atomicWriteIORef srRef sr

instance (MP.StateRoot `A.Alters` MP.NodeData) SetupDBM where
  lookup _ = MP.genericLookupDB $ asks stateDB
  insert _ = MP.genericInsertDB $ asks stateDB
  delete _ = MP.genericDeleteDB $ asks stateDB

instance HasMemRawStorageDB SetupDBM where
  getMemRawStorageTxDB = do
    cxt <- ask
    lst <- liftIO . readIORef . localStorageTx $ cxt
    return (stateDB cxt, lst)
  putMemRawStorageTxMap theMap = do
    lstref <- asks localStorageTx
    liftIO $ atomicWriteIORef lstref theMap
  getMemRawStorageBlockDB = do
    cxt <- ask
    lsb <- liftIO . readIORef . localStorageBlock $ cxt
    return (stateDB cxt, lsb)
  putMemRawStorageBlockMap theMap = do
    lsbref <- asks localStorageBlock
    liftIO $ atomicWriteIORef lsbref theMap

instance (RawStorageKey `A.Alters` RawStorageValue) SetupDBM where
  lookup _ = genericLookupRawStorageDB
  insert _ = genericInsertRawStorageDB
  delete _ = genericDeleteRawStorageDB

instance HasMemAddressStateDB SetupDBM where
  getAddressStateTxDBMap = liftIO . readIORef =<< asks localAddressStateTx
  putAddressStateTxDBMap theMap = do
    lastref <- asks localAddressStateTx
    liftIO $ atomicWriteIORef lastref theMap
  getAddressStateBlockDBMap = liftIO . readIORef =<< asks localAddressStateBlock
  putAddressStateBlockDBMap theMap = do
    lasbref <- asks localAddressStateBlock
    liftIO $ atomicWriteIORef lasbref theMap

instance (Address `A.Alters` AddressState) SetupDBM where
  lookup _ = getAddressStateMaybe
  insert _ = putAddressState
  delete _ = deleteAddressState

instance (SHA `A.Alters` DBCode) SetupDBM where
  lookup _ = genericLookupCodeDB $ asks codeDB
  insert _ = genericInsertCodeDB $ asks codeDB
  delete _ = genericDeleteCodeDB $ asks codeDB

instance (N.NibbleString `A.Alters` N.NibbleString) SetupDBM where
  lookup _ = genericLookupHashDB $ asks hashDB
  insert _ = genericInsertHashDB $ asks hashDB
  delete _ = genericDeleteHashDB $ asks hashDB

instance Mod.Accessible SQLDB SetupDBM where
  access _ = asks sqlDB

instance Mod.Accessible RBDB.RedisConnection SetupDBM where
  access _ = asks redisDB

{-
connStr :: ConnectionString
connStr = "host=localhost dbname=eth user=postgres password=api port=5432"
-}

defaultSqlConfig  ::  SqlConf
defaultSqlConfig =
    SqlConf {
      user = "postgres",
      password = "api",
      host = "localhost",
      port = 5432,
      database = "eth",
      poolsize = 10
    }

defaultKafkaConfig  ::  KafkaConf
defaultKafkaConfig = KafkaConf {
  kafkaHost = "localhost",
  kafkaPort = 9092
  }

defaultLevelDBConfig  ::  LevelDBConf
defaultLevelDBConfig =
    LevelDBConf {
      table = "",
      path = ""
    }

defaultBlockConfig  ::  BlockConf
defaultBlockConfig =
    BlockConf {
      blockTime = 13,
      minBlockDifficulty = 131072
    }

defaultPrivKey  ::  PrivKey
defaultPrivKey = PrivKey 0

defaultEthUniqueId  ::  EthUniqueId
defaultEthUniqueId =
    EthUniqueId {
      peerId = "",
      genesisHash = "",
      networkId = 0
    }

defaultQuarryConfig  ::  QuarryConf
defaultQuarryConfig =
    QuarryConf {
      coinbaseAddress = "ab",
      lazyBlocks = False
    }


defaultDiscoveryConfig  ::  DiscoveryConf
defaultDiscoveryConfig =
    DiscoveryConf {
      discoveryPort=30303,
      minAvailablePeers=100
    }

defaultRedisBlockDBConfig  ::  RedisBlockDBConf
defaultRedisBlockDBConfig = RedisBlockDBConf {
    redisHost           = flags_redisHost,
    redisPort           = flags_redisPort,
    redisAuth           = Nothing,
    redisDBNumber       = flags_redisDBNumber,
    redisMaxConnections = 10,
    redisMaxIdleTime    = 30
    }

defaultConfig  ::  EthConf
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
      discoveryConfig    = defaultDiscoveryConfig
    }

decodedFaucets :: [Address]
decodedFaucets = fromMaybe [] . Ae.decodeStrict . C.pack $ flags_extraFaucets

defaultPeers :: [(String,Int)]
defaultPeers =
  [
    --("127.0.0.1", 30303),
    --("52.87.251.111", 30303)   -- stratodev.blockapps.net
  ]

createKafkaTopic  ::  TopicName -> IO ()
createKafkaTopic topic = do
  result <- runKafka (mkKafkaState "strato-setup" (fromString flags_kafkahost, 9092)) $ updateMetadata topic
  case result of
   Left err -> error $ "error connecting to kafka at host '" ++ flags_kafkahost ++ "': " ++ show err
   _        -> return ()

topics  ::  [String]
topics = [ "unminedblock"
         , "statediff"
         , "seq_vm_events"
         , "seq_p2p_events"
         , "unseqevents"
         , "jsonrpcresponse"
         , "indexevents"
         , "block" -- todo: delet this.
         ]

genesisFiles :: [(FilePath, B.ByteString)]
genesisFiles = $(embedDir "genesisBlocks")

addStandardGenesisBlockIfNeeded :: String->IO ()
addStandardGenesisBlockIfNeeded genesisBlockName = do
  let genesisFileName = genesisBlockName ++ "Genesis.json"
      maybeJSON = lookup genesisFileName genesisFiles
      accountInfoFileName = genesisBlockName ++ "AccountInfo"
      maybeInfo = lookup accountInfoFileName genesisFiles

  jsonExists <- doesFileExist genesisFileName

  case (jsonExists, maybeJSON) of
   (True, _) -> return ()
   (_, Just contents) -> B.writeFile genesisFileName contents
   _ -> error $ "Search for genesis file has failed.  You need to supply a file named '" ++ genesisFileName ++ "'"

  infoExists <- doesFileExist accountInfoFileName
  case (infoExists, maybeInfo) of
    (True, _) -> return ()
    (_, Just contents) -> B.writeFile accountInfoFileName contents
    _ -> putStrLn "No account info file found. Will proceed without it\
                  \ and assume Genesis.json is self contained."

{-
  CONFIG:

  oneTimeSetup now creates .ethereumH and moves config files into it.
  It then creates the databases namespaced by UUIDs. We could probably use local paths here,
  but those strings might get annoyingly long.

  To be safe, this operation should be idempotent. Thus we check for the presence of ~/.ethereumH.

  Preconditions: installed LevelDB, Postgres, Kafka, Redis.
-}

oneTimeSetup  ::  String -> IO ()
oneTimeSetup genesisBlockName = do
  dirExists <- doesDirectoryExist ".ethereumH"

  if dirExists
    then do
        putStrLn ".ethereumH exists, unsafe to run setup"
        return ()
    else do
      let bootnodes = case (flags_addBootnodes, flags_stratoBootnode) of
                     (False, _)      -> Nothing
                     (True, [])      -> Just []
                     (True, [""])    -> Just []
                     (True, ipAddrs) -> Just ipAddrs
      liftIO $ putStrLn $ CL.red ">>>> Bootnodes: " ++ show bootnodes

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
             ""   -> error "specify password for postgres user: "
             pass -> return (Just pass)

      kafkaHostFlag <- case flags_kafkahost of
             "" -> do putStrLn "using default kafka host: localhost"
                      return "localhost"
             host' -> return host'

      bytes <- getEntropy 20

      createDirectoryIfMissing True $ dbDir "h"



      let user'' =  case maybePGuser of
                        Nothing  -> "postgres"
                        Just ""  -> "postgres"
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
      inflateDir stratoAPIConfigDir

      putStrLn $ CL.red "WARNING: the private key for this strato node is being written to the file .ethereumH/ethconf.yaml.  Please keep it secure; anyone who reads it will become you."
      encodeFile (".ethereumH" </> "ethconf.yaml") cfg'
      encodeFile (".ethereumH" </> "peers.yaml") defaultPeers

      {- CONFIG: register this blockchain with the global database -}

      currPath <- getCurrentDirectory

      Blockchain.migrateDB pgConnGlobal
      _ <- insertBlockchain pgConnGlobal currPath uniqueString

      {- CONFIG: Create the local database -}

      liftIO $ putStrLn $ CL.yellow ">>>> Creating Database " ++ db'
      liftIO $ putStrLn $ CL.blue $ "  connection is " ++ show pgConn'

      let query = T.pack $ "CREATE DATABASE " ++ show db' ++ ";"

      runNoLoggingT $ withPostgresqlConn pgConn' (runReaderT (rawExecute query []) :: SqlWriteBackend -> LoggingT IO ())

      {- CONFIG: create kafka topics -}

      --Replace this to re-enable unique topic names
      --let uniqueTopicMap = Map.fromList [(topic, topic ++ "_" ++ uniqueString) | topic <- topics]
      let uniqueTopicMap = Map.fromList [(topic, topic) | topic <- topics]
      encodeFile (".ethereumH" </> "topics.yaml") uniqueTopicMap

      {- kafkaTopics implicitly defined by ethconf.yaml above & unsafePerformIO -}

      forM_ kafkaTopics $ createKafkaTopic . fromString

      liftIO $ threadDelay 1000000 --Kafka needs this delay after creating topics!  Without this, when we send a message the program will crash for a short duration.  The choice of 1 second is empirically determined, if we are unlucky the number may need to be higher on other machines.

     {- CONFIG: define tables and indices -}
     {- connStr implicitly defined by ethconf.yaml above, & unsafePerformIO -}

      runLoggingT $ withPostgresqlConn connStr $ runReaderT $ do
         liftIO $ putStrLn $ CL.yellow ">>>> Migrating SQL DB"
         liftIO $ putStrLn $ CL.blue $ "  connection is " ++ show connStr

         runMigration DataDefs.migrateAll

         EthDiscovery.setup bootnodes

         liftIO $ putStrLn $ CL.yellow ">>>> Creating SQL Indexes"
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

      void . runResourceT $ do
         liftIO $ putStrLn $ CL.yellow ">>>> Setting UP DB handles"

     {- CONFIG: localized -}

         sdb <- DB.open (dbDir "h" ++ stateDBPath)
                DB.defaultOptions{DB.createIfMissing=True, DB.cacheSize=1024}
         hdb <- HashDB <$> DB.open (dbDir "h" ++ hashDBPath)
                DB.defaultOptions{DB.createIfMissing=True, DB.cacheSize=1024}
         cdb <- CodeDB <$> DB.open (dbDir "h" ++ codeDBPath)
                DB.defaultOptions{DB.createIfMissing=True, DB.cacheSize=1024}
         [m1, m2] <- liftIO . replicateM 2 . newIORef $ Map.empty
         [m3, m4] <- liftIO . replicateM 2 . newIORef $ Map.empty
         srRef <- liftIO . newIORef $ error "stateRoot not defined in oneTimeSetup"

         pool <- runNoLoggingT $ createPostgresqlPool connStr 20

         redisBDBPool <- RBDB.RedisConnection <$> liftIO (Redis.checkedConnect lookupRedisBlockDBConfig)

         void . runLoggingT $ flip runReaderT (SetupDBs sdb srRef hdb cdb pool redisBDBPool m1 m2 m3 m4) $ do
           void $ addCode EVM B.empty --blank code is the default for Accounts, but gets added nowhere else.
           liftIO $ putStrLn $ CL.yellow ">>>> Initializing Genesis Block"
           case (flags_backupmp, flags_backupblocks) of
             (False, False) -> initializeGenesisBlock NoBackup genesisBlockName decodedFaucets
             (True, True)   -> error "You can't choose --backupmp and --backupblocks at the same time"
             (False, True)  -> initializeGenesisBlock BlockBackup genesisBlockName decodedFaucets
             (True, False)  -> initializeGenesisBlock MPBackup genesisBlockName decodedFaucets
