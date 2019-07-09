{-# LANGUAGE BangPatterns          #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
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
import           System.Exit
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
import           Blockchain.EthConf.Model
import           Blockchain.Init.EthConf
import           Blockchain.KafkaTopics
import           Blockchain.Output
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

defineFlag "singlePrivateKey" (True :: Bool) "Whether to share P2P and PBFT keys"
defineFlag "minPeers" (0 :: Int) "Threshold for discovery to stop querying for more peers"

data SetupDBs =
  SetupDBs {
    stateDB :: StateDB,
    stateRoot :: IORef MP.StateRoot,
    hashDB  :: HashDB,
    codeDB  :: CodeDB,
    sqlDB   :: SQLDB,
    redisDB :: RBDB.RedisConnection,
    localStorageTx :: IORef (Map.Map (Address, B.ByteString) B.ByteString),
    localStorageBlock :: IORef (Map.Map (Address, B.ByteString) B.ByteString),
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
    lst <- liftIO . readIORef .localStorageTx $ cxt
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

decodedFaucets :: [Address]
decodedFaucets = fromMaybe [] . Ae.decodeStrict . C.pack $ flags_extraFaucets

oneTimeSetup  ::  String -> IO ()
oneTimeSetup genesisBlockName = do
  dirExists <- doesDirectoryExist ".ethereumH"

  if dirExists
    then die ".ethereumH exists, unsafe to run setup"
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


      createDirectoryIfMissing True $ dbDir "h"


     {- CONFIG: create database and write default config files, including strato-api -}

      ethconf <- genEthConf
      inflateDir stratoAPICerts
      inflateDir stratoAPIConfigDir

      putStrLn $ CL.red "WARNING: the private key for this strato node is being written to the file .ethereumH/ethconf.yaml.  Please keep it secure; anyone who reads it will become you."
      encodeFile (".ethereumH" </> "ethconf.yaml") ethconf
      encodeFile (".ethereumH" </> "peers.yaml") defaultPeers

      {- CONFIG: register this blockchain with the global database -}

      currPath <- getCurrentDirectory

      let pgconf = sqlConfig ethconf
          rawConn = postgreSQLConnectionString pgconf{database = ""}
          globalConn = postgreSQLConnectionString pgconf{database = "blockchain"}
          localConn = postgreSQLConnectionString pgconf
          db = database pgconf
      Blockchain.migrateDB globalConn
      _ <- insertBlockchain globalConn currPath . peerId . ethUniqueId $ ethconf

      {- CONFIG: Create the local database -}
      liftIO $ putStrLn $ CL.yellow ">>>> Creating Database " ++ db
      liftIO $ putStrLn $ CL.blue $ "  connection is " ++ show rawConn
      let query = T.pack $ "CREATE DATABASE " ++ show db ++ ";"

      runNoLoggingT $ withPostgresqlConn rawConn (runReaderT (rawExecute query []) :: SqlWriteBackend -> LoggingT IO ())

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

      runLoggingT $ withPostgresqlConn localConn $ runReaderT $ do
         liftIO $ putStrLn $ CL.yellow ">>>> Migrating SQL DB"
         liftIO $ putStrLn $ CL.blue $ "  connection is " ++ show localConn

         runMigration DataDefs.migrateAll
         liftIO $ putStrLn $ CL.yellow ">>>> Indexing SQL DB"
         runMigration DataDefs.indexAll

         liftIO $ putStrLn $ CL.yellow ">>>> Inserting bootnodes"
         EthDiscovery.setup bootnodes


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

         pool <- runNoLoggingT $ createPostgresqlPool localConn 20

         redisBDBPool <- RBDB.RedisConnection <$> liftIO (Redis.checkedConnect $ redisConnection $ redisBlockDBConfig ethconf)

         void . runLoggingT $ flip runReaderT (SetupDBs sdb srRef hdb cdb pool redisBDBPool m1 m2 m3 m4) $ do
           void $ addCode EVM B.empty --blank code is the default for Accounts, but gets added nowhere else.
           liftIO $ putStrLn $ CL.yellow ">>>> Initializing Genesis Block"
           initializeGenesisBlock genesisBlockName decodedFaucets
