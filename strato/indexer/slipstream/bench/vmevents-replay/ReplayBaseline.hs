{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}

import BlockApps.Logging
import qualified Blockchain.Data.DataDefs as DataDefs
import Blockchain.Slipstream.Data.CirrusTables (migrateAll)
import Blockchain.Slipstream.OutputData
import Blockchain.Slipstream.PostgresqlTypedShim (pgQuery)
import Blockchain.Slipstream.Processor (processTheMessages)
import Blockchain.Slipstream.SQL
import Blockchain.Stream.VMEvent (VMEvent)
import Conduit
import Control.Monad (void)
import Data.Binary (decodeFile)
import qualified Data.ByteString.Char8 as BC
import Data.Text.Encoding (encodeUtf8)
import qualified Database.Persist as Persist
import qualified Database.Persist.Postgresql as Postgres
import GHC.Clock (getMonotonicTimeNSec)
import System.Environment (getArgs)
import System.IO (IOMode (WriteMode), withFile)

usage :: String
usage = "usage: replay-baseline INPUT CIRRUS_CONNECTION ETH_CONNECTION LOG"

main :: IO ()
main = do
  args <- getArgs
  (inputPath, cirrusConnection, ethConnection, logPath) <-
    case args of
      [inputPath', cirrusConnection', ethConnection', logPath'] ->
        pure (inputPath', cirrusConnection', ethConnection', logPath')
      _ -> fail usage

  batches <- decodeFile inputPath :: IO [[VMEvent]]
  eventCount <- pure . sum $ map length batches
  withFile logPath WriteMode $ \logHandle ->
    runLoggingTWithHandleWithLevel logHandle LevelInfo $ do
      cirrusPool <- Postgres.createPostgresqlPool (BC.pack cirrusConnection) 10
      ethPool <- Postgres.createPostgresqlPool (BC.pack ethConnection) 10
      Postgres.runSqlPool (Postgres.runMigration migrateAll) cirrusPool
      Postgres.runSqlPool (Postgres.runMigration DataDefs.migrateAll) ethPool
      mapM_ (liftIO . pgQuery cirrusPool . encodeUtf8 . slipstreamQueryPostgres) initialSlipstreamQueries

      start <- liftIO getMonotonicTimeNSec
      mapM_ (processBatch cirrusPool ethPool) batches
      end <- liftIO getMonotonicTimeNSec
      let seconds = fromIntegral (end - start) / 1000000000 :: Double
          rate = fromIntegral eventCount / seconds :: Double
      liftIO $ putStrLn $ unwords
        [ "mode=baseline",
          "vmevents=" ++ show eventCount,
          "seconds=" ++ show seconds,
          "vmevents_per_second=" ++ show rate
        ]

processBatch :: Postgres.ConnectionPool -> Postgres.ConnectionPool -> [VMEvent] -> LoggingT IO ()
processBatch cirrusPool ethPool events =
  void . runConduit $
    processTheMessages events `fuseUpstream`
      dedupC `fuseUpstream`
      awaitForever (\case
        Left transactionResult ->
          lift . Postgres.runSqlPool (void $ Persist.insert_ transactionResult) $ ethPool
        Right command -> lift $ case command of
          InsertDelegatecall delegatecall -> insertDelegatecallPostgres cirrusPool delegatecall
          _ -> dbQueryCatchError cirrusPool $ slipstreamQueryPostgres command
      )
