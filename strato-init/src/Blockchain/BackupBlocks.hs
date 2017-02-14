{-# LANGUAGE OverloadedStrings #-}

module Blockchain.BackupBlocks (
  backupBlocks
  ) where

import Control.Monad
import Control.Monad.IO.Class
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import qualified Data.ByteString.Char8 as BC8
import qualified Data.ByteString.Base16 as B16
import Network.Kafka
import Network.Kafka.Producer


import Blockchain.DB.SQLDB
import Blockchain.EthConf
import Blockchain.KafkaTopics
--import Blockchain.Stream.Raw

import qualified Data.Binary as Binary
import qualified Blockchain.Stream.VMEvent as BSVME
import qualified Blockchain.Sequencer.Event as BSE

import qualified System.IO.Unsafe as YOUR_CODE_IS_SHIT
import qualified Data.IORef as IORef
--import Blockchain.Format (format)

decodeWithCheck::B.ByteString->B.ByteString
decodeWithCheck x =
  case B16.decode x of
   (result, "") -> result
   _ -> error "bad data passed to decodeWithCheck"

{-
backupBlocks'::HasSQLDB m=>m ()
backupBlocks' = do
  rawData <- liftIO $ fmap BLC.lines $ BL.getContents
  forM_ rawData $ \line -> 
    produceBytes "block" [decodeWithCheck . BL.toStrict $ line]
-}

{-# NOINLINE blockCounter #-}
blockCounter :: IORef.IORef Integer
blockCounter = YOUR_CODE_IS_SHIT.unsafePerformIO $ IORef.newIORef 1

produceVMEventsChunked :: HasSQLDB m => Int -> [BSVME.VMEvent] -> [BSVME.VMEvent] -> m ()
produceVMEventsChunked chunk xs ys = do
  unless (null xs) . void $ BSVME.produceVMEvents xs
  unless (null ys) $ let  (newXs, newYs) = splitAt chunk ys in produceVMEventsChunked chunk newXs newYs

backupBlocks::HasSQLDB m=>m ()
backupBlocks = do
  liftIO $ putStrLn "Start backupBlocks"
  liftIO $ putStrLn "Start backupBlocks => produceUnseqEvents"
  rawData <- liftIO $ fmap BC8.lines $ B.getContents
  decodedBlocks <- liftIO $ runKafkaConfigured "blockapps-data" $
    forM rawData $ \line -> do
        let predecoded = decodeWithCheck line
        let theIngestEvent = Binary.decode $ BL.fromStrict predecoded
        _ <- produceMessages $ (TopicAndMessage (lookupTopic "unseqevents") . makeMessage) <$> [predecoded]
        bumpRestoredBlock predecoded

        return $ case theIngestEvent of
            BSE.IEBlock b -> [BSVME.ChainBlock $ BSE.ingestBlockToBlock b]
            _ -> []
  case decodedBlocks of
    Left err -> error $ "error decoding/kafka-writing blocks: " ++ show err
    Right db -> do
      liftIO $ putStrLn "End backupBlocks => produceUnseqEvents"
      liftIO $ putStrLn "Start backupBlocks => produceVMEvents"
      
      produceVMEventsChunked 1000 [] (concat db) 

      liftIO $ putStrLn "End backupBlocks => produceVMEvents"
      liftIO $ putStrLn "End backupBlocks"
      return ()

bumpRestoredBlock :: MonadIO m => B.ByteString -> m ()
bumpRestoredBlock _ = liftIO $ do
    lastCounter <- IORef.readIORef blockCounter
    IORef.writeIORef blockCounter (lastCounter + 1)
    --putStrLn . format $ (Binary.decode (BL.fromStrict b) :: BSE.IngestEvent)
    putStrLn $ "Restored " ++ (show lastCounter) ++ " blocks"

