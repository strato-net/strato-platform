{-# LANGUAGE OverloadedStrings #-}

import BlockApps.Logging
import qualified Blockchain.Data.DataDefs as DataDefs
import Blockchain.Slipstream.Data.CirrusTables (migrateAll)
import Blockchain.Slipstream.MessageConsumer (sinkSlipstreamOutputChunks, slipstreamOutputChunkSize)
import Blockchain.Slipstream.OutputData
import Blockchain.Slipstream.PostgresqlTypedShim (pgQuery)
import Blockchain.Slipstream.Processor (processTheMessages)
import Blockchain.Slipstream.SQL (performSlipstreamQueries)
import Blockchain.Stream.VMEvent (VMEvent)
import Conduit
import Control.Monad (unless, void)
import Data.Binary (decodeFile)
import qualified Data.ByteString.Char8 as BC
import Data.IORef
import Data.Text.Encoding (encodeUtf8)
import qualified Database.Persist as Persist
import qualified Database.Persist.Postgresql as Postgres
import GHC.Clock (getMonotonicTimeNSec)
import System.Environment (getArgs)
import System.IO (IOMode (WriteMode), withFile)

usage :: String
usage = "usage: replay-candidate INPUT CIRRUS_CONNECTION ETH_CONNECTION LOG"

main :: IO ()
main = do
  args <- getArgs
  (inputPath, cirrusConnection, ethConnection, logPath) <-
    case args of
      [inputPath', cirrusConnection', ethConnection', logPath'] ->
        pure (inputPath', cirrusConnection', ethConnection', logPath')
      _ -> fail usage

  batches <- decodeFile inputPath :: IO [[VMEvent]]
  let eventCount = sum $ map length batches
  withFile logPath WriteMode $ \logHandle ->
    runLoggingTWithHandleWithLevel logHandle LevelInfo $ do
      cirrusPool <- Postgres.createPostgresqlPool (BC.pack cirrusConnection) 10
      ethPool <- Postgres.createPostgresqlPool (BC.pack ethConnection) 10
      Postgres.runSqlPool (Postgres.runMigration migrateAll) cirrusPool
      Postgres.runSqlPool (Postgres.runMigration DataDefs.migrateAll) ethPool
      mapM_ (liftIO . pgQuery cirrusPool . encodeUtf8 . slipstreamQueryPostgres) initialSlipstreamQueries

      start <- liftIO getMonotonicTimeNSec
      phaseResults <- mapM (processBatch cirrusPool ethPool) batches
      end <- liftIO getMonotonicTimeNSec
      let seconds = fromIntegral (end - start) / 1000000000 :: Double
          rate = fromIntegral eventCount / seconds :: Double
          transformSeconds = sum [transform | (transform, _, _, _, _) <- phaseResults]
          cirrusSeconds = sum [cirrus | (_, cirrus, _, _, _) <- phaseResults]
          transactionResultSeconds = sum [transactionResults | (_, _, transactionResults, _, _) <- phaseResults]
          cirrusQueries = sum [queries | (_, _, _, queries, _) <- phaseResults]
          transactionResults = sum [results | (_, _, _, _, results) <- phaseResults]
      liftIO $ putStrLn $ unwords
        [ "mode=candidate",
          "vmevents=" ++ show eventCount,
          "seconds=" ++ show seconds,
          "vmevents_per_second=" ++ show rate,
          "transform_seconds=" ++ show transformSeconds,
          "cirrus_seconds=" ++ show cirrusSeconds,
          "transaction_result_seconds=" ++ show transactionResultSeconds,
          "cirrus_queries=" ++ show cirrusQueries,
          "transaction_results=" ++ show transactionResults
        ]

processBatch :: Postgres.ConnectionPool -> Postgres.ConnectionPool -> [VMEvent] -> LoggingT IO (Double, Double, Double, Int, Int)
processBatch cirrusPool ethPool events = do
  cirrusSecondsRef <- liftIO $ newIORef 0
  transactionResultSecondsRef <- liftIO $ newIORef 0
  queryCountRef <- liftIO $ newIORef 0
  transactionResultCountRef <- liftIO $ newIORef 0
  batchStart <- liftIO getMonotonicTimeNSec
  (_emittedEvents, ()) <- runConduit $
    (processTheMessages events `fuseUpstream` dedupC) `fuseBoth`
      sinkSlipstreamOutputChunks slipstreamOutputChunkSize
        (writeChunk cirrusSecondsRef transactionResultSecondsRef queryCountRef transactionResultCountRef)
  batchEnd <- liftIO getMonotonicTimeNSec
  cirrusSeconds <- liftIO $ readIORef cirrusSecondsRef
  transactionResultSeconds <- liftIO $ readIORef transactionResultSecondsRef
  queryCount <- liftIO $ readIORef queryCountRef
  transactionResultCount <- liftIO $ readIORef transactionResultCountRef
  let transformSeconds = elapsedSeconds batchStart batchEnd - cirrusSeconds - transactionResultSeconds
  pure
    ( transformSeconds,
      cirrusSeconds,
      transactionResultSeconds,
      queryCount,
      transactionResultCount
    )
  where
    writeChunk cirrusSecondsRef transactionResultSecondsRef queryCountRef transactionResultCountRef slipstreamQueries transactionResults = do
      cirrusSeconds <- timed $ performSlipstreamQueries cirrusPool slipstreamQueries
      transactionResultSeconds <-
        if null transactionResults
          then pure 0
          else timed . void $ Postgres.runSqlPool (Persist.insertMany transactionResults) ethPool
      liftIO $ do
        modifyIORef' cirrusSecondsRef (+ cirrusSeconds)
        modifyIORef' transactionResultSecondsRef (+ transactionResultSeconds)
        modifyIORef' queryCountRef (+ length slipstreamQueries)
        modifyIORef' transactionResultCountRef (+ length transactionResults)

    timed action = do
      start <- liftIO getMonotonicTimeNSec
      action
      end <- liftIO getMonotonicTimeNSec
      pure $ elapsedSeconds start end

elapsedSeconds :: Integral a => a -> a -> Double
elapsedSeconds start end = fromIntegral (end - start) / 1000000000
