{-# LANGUAGE BangPatterns          #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE LambdaCase            #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE TemplateHaskell       #-}

module Blockchain.Setup (
  oneTimeSetup
  ) where

import           Control.Concurrent
import           Control.Monad
import           Control.Monad.IO.Class
import           Control.Monad.Trans.Reader
import           Control.Monad.Trans.Resource
import qualified Data.Aeson                         as Ae
import qualified Data.ByteString                    as B
import qualified Data.ByteString.Char8              as C
import           Data.FileEmbed
import qualified Data.Map                           as Map
import           Data.Maybe
import           Data.String
import qualified Data.Text                          as T
import           Data.Yaml
import           Database.Persist.Postgresql        hiding (get)
import           Network.Kafka
import           Network.Kafka.Protocol
import           System.Directory
import           System.Exit
import           System.FilePath

import           Blockchain.APIFiles
import           Blockchain.Constants
import           Blockchain.Data.Blockchain         as Blockchain
import qualified Blockchain.Data.DataDefs           as DataDefs
import           Blockchain.GenesisBlock
import           Blockchain.DB.CodeDB
import           Blockchain.EthConf.Model
import           Blockchain.Init.EthConf
import           Blockchain.Init.Monad
import           Blockchain.Init.Options
import           Blockchain.KafkaTopics
import           Blockchain.Output
import           Blockchain.Strato.Model.Address

import qualified Executable.EthDiscoverySetup       as EthDiscovery

import qualified Text.Colors                        as CL

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

      void . runResourceT . runLoggingT . runSetupDBM $ do
         liftIO $ putStrLn $ CL.yellow ">>>> Setting UP DB handles"
         void $ addCode EVM B.empty --blank code is the default for Accounts, but gets added nowhere else.
         liftIO $ putStrLn $ CL.yellow ">>>> Initializing Genesis Block"
         initializeGenesisBlock genesisBlockName decodedFaucets
