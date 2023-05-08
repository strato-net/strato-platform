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
import Text.Printf
import Text.RawString.QQ

import Bloc.Monad (BlocEnv(..))
import BlockApps.Init
import BlockApps.Logging

import Control.Monad.Composable.BlocSQL
import Control.Monad.Composable.Kafka
import Control.Monad.Composable.SQL

import Slipstream.MessageConsumer
import Slipstream.Data.Globals
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
  return BlocEnv { stateFetchLimit = 0
                 , gasOn=error("gasOn shouldn't be needed in slipstream, it is undefined")
                 , evmCompatible=False
                 , accountNonceLimit=0
                 , globalNonceCounter=error("globalNonceCounter shouldn't be needed in slipstream, it is undefined")
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
    -- like not adding Certs to cirrus
    -- Below scrapes the cirrus table names
    -- and the respective column names
    -- converts the information to the proper types
    -- to restore the in memeory state

    let getPGValues :: MonadIO m => B.ByteString -> m [PGValues]
        getPGValues = liftIO . pgQuery conn

    let convertFromPGTextValueToShowable :: (B.ByteString -> a) -> PGValue -> Maybe a
        convertFromPGTextValueToShowable f c = case  c of (PGTextValue txt )  -> Just $ f txt ;  _ -> Nothing


    allTableNamesInByteString :: IO [B.ByteString] <- return $
                        mapMaybe (convertFromPGTextValueToShowable id).
                        concat <$>
                        (pgQuery conn ([r|select table_name from information_schema.tables where
                            table_name like '%-%' or
                            table_name like '%Certificate%' or
                            table_name like '%Mercata%' |] :: BC.ByteString) :: IO [PGValues])

    let sqlStatement x     = encodeUtf8 "SELECT column_name FROM information_schema.columns WHERE table_name Like \'" <> x <> (encodeUtf8 "\';")   :: B.ByteString

    tableNamesWithPgValues :: IO [(TableName, [PGValues])] <- return $
                                join $
                                mapM
                                    (\tableNam -> ((parseStringToTableName $ T.unpack . decodeUtf8 $ tableNam ,)  <$>) $ getPGValues . sqlStatement $ tableNam )  <$> allTableNamesInByteString
    let createdTables = M.map ( mapMaybe (convertFromPGTextValueToShowable  decodeUtf8) . concat) . M.fromList <$> tableNamesWithPgValues
    -- Scrape Finished

    -- There are three permanent connections/pools to postgres:
    -- 1. The `workerConn` is from persistent-postgresql for the storage worker in the background
    -- 2. `conn` connects slipstream to the cirrus database
    -- 3. The `pool` in the BlocEnv connects slipstream to the bloc22 database

    handle <- runReaderT initStorage workerConn

    gref <- join $ liftIO $ flip newGlobals handle <$> createdTables
    sqlEnv <- createBlocSQLEnv flags_pghost (fromIntegral flags_pgport) flags_pguser flags_password

    getAndProcessMessages env sqlEnv conn gref
