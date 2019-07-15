{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
module Kafka (saveKafka, loadKafka, verifyKafkaFile, readMsg, writeMsg) where

import Control.Lens.Operators ((.=))
import Control.Monad
import Control.Monad.IO.Class
import qualified Data.ByteString as B
import Data.Memory.Endian (fromBE, toBE)
import Data.String
import Data.Word
import Foreign.Marshal.Alloc
import Foreign.Storable
import System.Exit
import System.IO
import Text.Printf

import Blockchain.EthConf
import Blockchain.Stream.Raw
import Network.Kafka
import Network.Kafka.Protocol


-- Binary files are stored as a series of records, with 4 bytes used to encode
-- the length of each record (big endian) and then that many bytes for the payload.

headerLen :: Int
headerLen = sizeOf (0x0:: Word32)

writeMsg :: Handle -> B.ByteString -> IO ()
writeMsg h msg =
  let l = B.length msg
  in if l > 0xffffffff
       then die $ printf "encoding failure: len too large for header: %d" $ B.length msg
       else alloca $ \lbuf -> do
          let wl = fromIntegral l :: Word32
          poke lbuf $ toBE wl
          hPutBuf h lbuf headerLen
          B.hPut h msg


readMsg :: Handle -> IO (Maybe B.ByteString)
readMsg h = do
  done <- hIsEOF h
  if done
    then return Nothing
    else alloca $ \lbuf -> do
            bytesRead <- hGetBuf h lbuf headerLen
            when (bytesRead < headerLen) .
              die $ printf "decoding failure: header too short: %d < %d" bytesRead headerLen
            wl <- fromBE <$> peek lbuf :: IO Word32
            msg <- B.hGet h (fromIntegral wl)
            when (B.length msg < fromIntegral wl) .
              die $ printf "decoding failure: payload too short: %d < %d" (B.length msg) wl
            return $ Just msg

saveKafka :: String -> FilePath -> IO ()
saveKafka topic' file = do
  let topic = fromString topic'
  withBinaryFile file WriteMode $ \h -> do
    hSetBuffering h . BlockBuffering . Just $ 1024 * 1024
    res <- runKafkaConfigured "querystrato" $ do
      stateBufferSize .= 100 * 1024 * 1024
      let loop :: Kafka k => Offset -> k ()
          loop off = do
            msgs <- fetchBytes topic off
            mapM_ (liftIO . writeMsg h) msgs
            loop (off + fromIntegral (length msgs))
      loop 0
    either (die . show) return res


loadKafka :: String -> FilePath -> IO ()
loadKafka topic file = do
  withBinaryFile file ReadMode $ \h -> do
    hSetBuffering h . BlockBuffering . Just $ 1024 * 1024
    res <- runKafkaConfigured "queryStrato" $ do
      let loop :: Kafka k => k ()
          loop = do
            -- TODO: batch writes
            mMsg <- liftIO $ readMsg h
            case mMsg of
              Nothing -> return ()
              Just msg -> produceBytes topic [msg] >> loop
      loop
    either (die . show) return res


verifyKafkaFile :: FilePath -> IO ()
verifyKafkaFile file = do
  withBinaryFile file ReadMode $ \h -> do
    hSetBuffering h . BlockBuffering . Just $ 1024 * 1024
    let loop :: Int -> Int -> IO (Int, Int)
        loop msgs bytes = do
          mMsg <- readMsg h
          case mMsg of
            Nothing -> return (msgs, bytes)
            Just msg -> do
              printf "Read message %d: %d\n" msgs $ B.length msg
              loop (msgs + 1) (bytes + B.length msg)
    (msgsRead, bytesRead) <- loop 0 0
    printf "%d messages read, %d bytes read\n" msgsRead bytesRead
