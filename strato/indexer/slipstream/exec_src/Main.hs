{-# LANGUAGE
      OverloadedStrings
    , RecordWildCards
    , QuasiQuotes
    , ScopedTypeVariables
    , DataKinds
    , TemplateHaskell
    , FlexibleContexts
    , TupleSections
#-}

import Control.Concurrent
import Control.Monad
import Control.Monad.IO.Class
import Control.Monad.Trans.Reader
import Control.Monad.Trans.Resource
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import           Data.Cache
import qualified Data.Map as M
import           Data.Maybe
import qualified Data.Text as T 
import Data.String
import Database.Persist.Postgresql
import Database.PostgreSQL.Typed
import Data.Text.Encoding
import Database.PostgreSQL.Typed.Types
import HFlags
import Network.Kafka hiding (runKafka)
import Network.Wai.Handler.Warp
import Network.Wai.Middleware.Prometheus
import System.Clock
import System.Exit
import Text.Printf
import Text.RawString.QQ
import Text.Regex.Posix

import BlockApps.Bloc22.Monad (BlocEnv(..))
import BlockApps.Init
import BlockApps.Logging

import Control.Monad.Composable.BlocSQL
import Control.Monad.Composable.Kafka
import Control.Monad.Composable.SQL

import Slipstream.MessageConsumer
import Slipstream.Globals
import Slipstream.GlobalsColdStorage
import Slipstream.Options
import Slipstream.OutputData

import SelectAccessible ()

workerConnStr :: ConnectionString
workerConnStr = BC.pack $ printf "host=%s port=%d user=%s password=%s dbname=%s"
                        flags_pghost flags_pgport flags_pguser flags_password flags_database

createBlocEnv :: MonadIO m => m BlocEnv
createBlocEnv = liftIO $ do
  codePtrCache <- newCache . Just $ TimeSpec (fromIntegral flags_sourceCacheTimeout) 0
  sourceCache <- newCache . Just $ TimeSpec (fromIntegral flags_sourceCacheTimeout) 0
  return BlocEnv { stateFetchLimit = 0
                 , gasOn=error("gasOn shouldn't be needed in slipstream, it is undefined")
                 , evmCompatible=False
                 , globalNonceCounter=error("globalNonceCounter shouldn't be needed in slipstream, it is undefined")
                 , globalSourceCache=sourceCache
                 , globalCodePtrCache=codePtrCache
                 , txTBQueue=error("txTBQueue shouldn't be needed in slipstream, it is undefined")
    }
    

connectToCirrus :: MonadIO m => m PGConnection
connectToCirrus = liftIO $ pgConnect cirrusInfo

main :: IO ()
main = do
  _ <- $initHFlags "Setup Slipstream Variables"
  blockappsInit "slipstream_main"
  
  runLoggingT 
    . runResourceT
    . runKafkaM ("slipstream" :: KafkaClientId) (fromString flags_kafkahost, fromIntegral flags_kafkaport)
    . runSQLM
    . withPostgresqlConn workerConnStr $ \workerConn -> do
    
    $logInfoS "main" "Welcome to Slipstream!!!!"
    void . liftIO . forkIO . run 10777 $ metricsApp
    $logInfoS "main" "Serving metrics on port 10777"

    env <- createBlocEnv
    conn <- connectToCirrus
    let migrateCirrus :: MonadIO m => B.ByteString -> m ()
        migrateCirrus = liftIO . void . pgQuery conn
    migrateCirrus  [r|create table if not exists
                      contract (id serial primary key, "codeHash" text, contract text, abi text)|]
    migrateCirrus [r|alter table contract add column if not exists "chainId" text|]

    -- After a ./strato --stop
    -- The in memory state gets wiped
    -- This causes cirrus issues
    -- Below scrapes the cirrus tableNames and column names
    -- to restore the in memory map that tracks this

    let getPGValues :: MonadIO m => B.ByteString -> m [PGValues]
        getPGValues = liftIO . pgQuery conn

    let getColumnNames ::  B.ByteString -> IO [PGValues]
        getColumnNames = liftIO . pgQuery conn

    liftIO $  putStrLn "HELLO1 GARRETT"

    let getAllTableNames :: IO [PGValue]
        getAllTableNames = concat <$> (getPGValues [r|select table_name from information_schema.tables where 
            table_name like '%-%' or 
            table_name like '%Certificate%' or 
            table_name like '%Mercata%' |])
    allTableNamesInPGValue <- return getAllTableNames

    -- liftIO $ join $ ( putStrLn   <$> ) $ (concat <$>) $ (map  ( show)) <$> allTableNamesInPGValue -- Print everything we get back from this

    let convertFromPGTextValueToByteString :: PGValue -> Maybe B.ByteString
        convertFromPGTextValueToByteString c = case  c of (PGTextValue txt )  -> Just $ txt ;  _ -> Nothing 

    liftIO $  putStrLn "BEFORE SELECT COL STMT"
    let convertFromPGTextValueToText :: PGValue -> Maybe T.Text
        convertFromPGTextValueToText c = case  c of (PGTextValue txt )  -> Just $ decodeUtf8 txt ;  _ -> Nothing 
        
        thisListOfTableNames = (mapMaybe convertFromPGTextValueToByteString) <$> allTableNamesInPGValue :: IO [B.ByteString]

        sqlStatement x = (encodeUtf8 "SELECT column_name FROM information_schema.columns WHERE table_name Like \'") <> x <> (encodeUtf8 "\';")  :: B.ByteString
    
        namesToPgValues  =  (map  (\tableNam -> ((show tableNam ,)  <$>) $ getColumnNames . sqlStatement $ tableNam ) <$> thisListOfTableNames) :: IO [IO  (String, [PGValues])]

        tableNameMap = (M.map  concat <$>)  $ (M.fromList <$>) $ join $ (sequence) <$> namesToPgValues   :: IO (M.Map  String [PGValue])

        mapBytStringTablecolumns = (M.map ( mapMaybe convertFromPGTextValueToText )) <$> tableNameMap  :: IO (M.Map  String TableColumns) --TODO Make sure maybeMap does not filter things we want
    
    -- Helpers to make TableNames
    let stringArrToHistoryTableName :: [T.Text]  -> TableName
        stringArrToHistoryTableName [contract]           = HistoryTableName T.empty T.empty  contract
        stringArrToHistoryTableName [org, contract]      = HistoryTableName  org  contract  contract
        stringArrToHistoryTableName [org, app, contract] = HistoryTableName  org  app  contract
        stringArrToHistoryTableName _ = error "whoops"
    let stringArrToIndexTableName :: [T.Text]  -> TableName
        stringArrToIndexTableName [contract]           = IndexTableName T.empty T.empty  contract
        stringArrToIndexTableName [org, contract]      = IndexTableName  org  contract  contract
        stringArrToIndexTableName [org, app, contract] = IndexTableName  org  app  contract
        stringArrToIndexTableName _ = error "whoops"
    let stringArrToEventTableName :: [T.Text]  -> TableName
        stringArrToEventTableName [contract, eventName]           = EventTableName T.empty T.empty contract eventName
        stringArrToEventTableName [org, contract, eventName]      = EventTableName org contract contract eventName
        stringArrToEventTableName [org, app, contract, eventName] = EventTableName org app contract eventName
        stringArrToEventTableName _ = error "whoops"
        
        period = "."         :: String
        history = "history@" :: String

    let parseStringToTableName :: String -> TableName
        parseStringToTableName bs
            | bs =~ period  :: Bool = let (tableStuff, _, eventName) = bs =~ period  :: (String, String, String)
                                         in stringArrToEventTableName $ (T.splitOn (T.pack "-") $ T.pack tableStuff ) ++ [(T.pack eventName)]
            | bs =~ history :: Bool = let (_, _, tableStuff) = bs =~ history  :: (String, String, String) 
                                         in stringArrToHistoryTableName $ T.splitOn  (T.pack "-") $ T.pack tableStuff
            | otherwise                = stringArrToIndexTableName $ T.splitOn (T.pack "-") (T.pack bs)                                           
        

        createdTables =  (M.mapKeysMonotonic parseStringToTableName) <$> mapBytStringTablecolumns :: IO (M.Map  TableName TableColumns)


    liftIO $ join $ putStrLn . show <$> createdTables 
    
    liftIO $  putStrLn "HELLO2 GARRETT"





    -- There are three permanent connections/pools to postgres:
    -- 1. The `workerConn` is from persistent-postgresql for the storage worker in the background
    -- 2. `conn` connects slipstream to the cirrus database
    -- 3. The `pool` in the BlocEnv connects slipstream to the bloc22 database
      
    (ourBloom, handle) <- runReaderT (initStorage flags_globalsStateCount) workerConn
    unless ourBloom . liftIO . die $
      "storage has been previously initialized! This should not happen"

    gref <- join $ liftIO $ (flip newGlobals handle ) <$> createdTables
    sqlEnv <- createBlocSQLEnv flags_pghost (fromIntegral flags_pgport) flags_pguser flags_password
      
    getAndProcessMessages env sqlEnv conn gref