{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}

module Blockchain.BackupBlocks (
  backupBlocks
  ) where

import           Control.Monad
import           Control.Monad.IO.Class
import qualified Data.ByteString             as B
import qualified Data.ByteString.Base16      as B16
import qualified Data.ByteString.Char8       as BC8
import           Network.Kafka
import           Network.Kafka.Producer


import           Blockchain.DB.SQLDB
import           Blockchain.EthConf
import           Blockchain.KafkaTopics

import qualified Data.IORef                  as IORef
import qualified System.IO.Unsafe            as YOUR_CODE_IS_SHIT

decodeWithCheck::B.ByteString->B.ByteString
decodeWithCheck x =
  case B16.decode x of
   (result, "") -> result
   _            -> error "bad data passed to decodeWithCheck"

{-# NOINLINE blockCounter #-}
blockCounter :: IORef.IORef Integer
blockCounter = YOUR_CODE_IS_SHIT.unsafePerformIO $ IORef.newIORef 1

backupBlocks :: HasSQLDB m => m ()
backupBlocks = do
  liftIO $ putStrLn "Start backupBlocks"
  liftIO $ putStrLn "Start backupBlocks => produceUnseqEvents"
  rawData <- liftIO $ fmap BC8.lines $ B.getContents
  writeOp <- liftIO $ runKafkaConfigured "blockapps-data" $
    forM_ rawData $ \line -> do
        let predecoded = decodeWithCheck line
        _ <- produceMessages $ (TopicAndMessage (lookupTopic "unseqevents") . makeMessage) <$> [predecoded]
        bumpRestoredBlock predecoded
        return ()
  case writeOp of
    Left err -> error $ "error decoding/kafka-writing blocks: " ++ show err
    Right () -> do
      liftIO $ putStrLn "End backupBlocks => produceUnseqEvents"
      liftIO $ putStrLn "End backupBlocks"
      return ()

bumpRestoredBlock :: MonadIO m => B.ByteString -> m ()
bumpRestoredBlock _ = liftIO $ do
    lastCounter <- IORef.readIORef blockCounter
    IORef.writeIORef blockCounter (lastCounter + 1)
    putStrLn $ "Restored " ++ (show lastCounter) ++ " blocks"

