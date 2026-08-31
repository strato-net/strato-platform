{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

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
import Control.Monad.Composable.Streaming
  ( createTopicAndWait,
    produceToTopics,
    runConsume,
    runStreamM,
  )
import Control.Monad.Trans.Class (lift)
import Data.Binary (decodeFile, encode)
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Lazy as BL
import Data.IORef
import Data.String (fromString)
import Data.Text.Encoding (encodeUtf8)
import qualified Database.Persist as Persist
import qualified Database.Persist.Postgresql as Postgres
import GHC.Clock (getMonotonicTimeNSec)
import System.Environment (getArgs)
import System.IO (IOMode (WriteMode), withFile)

usage :: String
usage = "usage: kafka-replay-candidate INPUT HOST PORT TOPIC GROUP CIRRUS_CONNECTION ETH_CONNECTION LOG"

main :: IO ()
main = do
  args <- getArgs
  (inputPath, host, port, topicText, groupText, cirrusConnection, ethConnection, logPath) <-
    case args of
      [inputPath', host', portText, topicText', groupText', cirrusConnection', ethConnection', logPath'] ->
        pure (inputPath', host', read portText, topicText', groupText', cirrusConnection', ethConnection', logPath')
      _ -> fail usage

  batches <- decodeFile inputPath :: IO [[VMEvent]]
  let eventCount = sum $ length <$> batches
      topic = fromString topicText
      groupName = fromString groupText

  withFile logPath WriteMode $ \logHandle ->
    runLoggingTWithHandleWithLevel logHandle LevelInfo $ do
      cirrusPool <- Postgres.createPostgresqlPool (BC.pack cirrusConnection) 10
      ethPool <- Postgres.createPostgresqlPool (BC.pack ethConnection) 10
      Postgres.runSqlPool (Postgres.runMigration migrateAll) cirrusPool
      Postgres.runSqlPool (Postgres.runMigration DataDefs.migrateAll) ethPool
      mapM_ (liftIO . pgQuery cirrusPool . encodeUtf8 . slipstreamQueryPostgres) initialSlipstreamQueries

      runStreamM "slipstream-benchmark-producer" (host, port) $ do
        createTopicAndWait topic
        mapM_
          (\payloads -> void . produceToTopics $ [(topic, payloads)])
          . chunksByBytes 2000000
          $ (BL.toStrict . encode) <$> concat batches

      consumedRef <- liftIO $ newIORef 0
      phaseRef <- liftIO $ newIORef (0, 0, 0)
      start <- liftIO getMonotonicTimeNSec
      runStreamM "slipstream-benchmark-consumer" (host, port) $
        runConsume groupName topic $ \(events :: [VMEvent]) -> do
          phaseResults <- lift . mapM (processBatch cirrusPool ethPool) $ [events]
          let transform = sum [seconds | (seconds, _, _) <- phaseResults]
              cirrus = sum [seconds | (_, seconds, _) <- phaseResults]
              transactionResults = sum [seconds | (_, _, seconds) <- phaseResults]
          consumed <- liftIO $ atomicModifyIORef' consumedRef $ \count ->
            let count' = count + length events
             in (count', count')
          liftIO $ modifyIORef' phaseRef $ \(oldTransform, oldCirrus, oldTransactionResults) ->
            ( oldTransform + transform,
              oldCirrus + cirrus,
              oldTransactionResults + transactionResults
            )
          pure $ if consumed >= eventCount then Just () else Nothing
      end <- liftIO getMonotonicTimeNSec

      consumed <- liftIO $ readIORef consumedRef
      (transformSeconds, cirrusSeconds, transactionResultSeconds) <- liftIO $ readIORef phaseRef
      let seconds = elapsedSeconds start end
          rate = fromIntegral consumed / seconds :: Double
      liftIO $ putStrLn $ unwords
        [ "mode=kafka-candidate",
          "vmevents=" ++ show consumed,
          "seconds=" ++ show seconds,
          "vmevents_per_second=" ++ show rate,
          "transform_seconds=" ++ show transformSeconds,
          "cirrus_seconds=" ++ show cirrusSeconds,
          "transaction_result_seconds=" ++ show transactionResultSeconds
        ]

processBatch :: Postgres.ConnectionPool -> Postgres.ConnectionPool -> [VMEvent] -> LoggingT IO (Double, Double, Double)
processBatch cirrusPool ethPool events = do
  cirrusSecondsRef <- liftIO $ newIORef 0
  transactionResultSecondsRef <- liftIO $ newIORef 0
  batchStart <- liftIO getMonotonicTimeNSec
  (_emittedEvents, ()) <- runConduit $
    (processTheMessages events `fuseUpstream` dedupC) `fuseBoth`
      sinkSlipstreamOutputChunks slipstreamOutputChunkSize (writeChunk cirrusSecondsRef transactionResultSecondsRef)
  batchEnd <- liftIO getMonotonicTimeNSec
  cirrusSeconds <- liftIO $ readIORef cirrusSecondsRef
  transactionResultSeconds <- liftIO $ readIORef transactionResultSecondsRef
  pure
    ( elapsedSeconds batchStart batchEnd - cirrusSeconds - transactionResultSeconds,
      cirrusSeconds,
      transactionResultSeconds
    )
  where
    writeChunk cirrusSecondsRef transactionResultSecondsRef slipstreamQueries transactionResults = do
      cirrusSeconds <- timed $ performSlipstreamQueries cirrusPool slipstreamQueries
      transactionResultSeconds <-
        if null transactionResults
          then pure 0
          else timed . void $ Postgres.runSqlPool (Persist.insertMany transactionResults) ethPool
      liftIO $ do
        modifyIORef' cirrusSecondsRef (+ cirrusSeconds)
        modifyIORef' transactionResultSecondsRef (+ transactionResultSeconds)

    timed action = do
      start <- liftIO getMonotonicTimeNSec
      action
      end <- liftIO getMonotonicTimeNSec
      pure $ elapsedSeconds start end

elapsedSeconds :: Integral a => a -> a -> Double
elapsedSeconds start end = fromIntegral (end - start) / 1000000000

chunksByBytes :: Int -> [B.ByteString] -> [[B.ByteString]]
chunksByBytes limit = go [] 0
  where
    go [] _ [] = []
    go chunk _ [] = [reverse chunk]
    go [] _ (value : rest)
      | B.length value > limit = [value] : go [] 0 rest
    go chunk chunkBytes values@(value : rest)
      | chunkBytes + B.length value > limit = reverse chunk : go [] 0 values
      | otherwise = go (value : chunk) (chunkBytes + B.length value) rest
