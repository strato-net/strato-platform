{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TupleSections #-}
module Kafka (saveKafka, loadKafka, verifyKafkaFile, readMsg, writeMsg) where

import Control.Lens.Combinators (_1, _2, use, uses)
import Control.Lens.Operators ((.=), (+=), (%=))
import Control.Monad
import Control.Monad.Trans.State
import Control.Monad.IO.Class
import qualified Data.ByteString as B
import Conduit
import qualified Data.Conduit.List as CL
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
import Blockchain.Strato.StateDiff.Kafka
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
      stateWaitTime .= 500
      let loop :: Kafka k => Offset -> k ()
          loop off = do
            msgs <- fetchBytes topic off
            unless (null msgs) $ do
              mapM_ (liftIO . writeMsg h) msgs
              loop (off + fromIntegral (length msgs))
      loop 0
    either (die . show) return res


unfoldM' :: Monad m => m (Maybe a) -> ConduitT void a m ()
unfoldM' mv = CL.unfoldM (\() -> fmap (, ()) <$> mv) ()

streamFile :: MonadIO m => Handle -> ConduitT void B.ByteString m ()
streamFile h = unfoldM' (liftIO $ readMsg h)

maxBundleSize :: Int
maxBundleSize = 1024 * 1024

bundleMessages :: MonadIO m => ConduitT B.ByteString [B.ByteString] m ()
bundleMessages = void . flip runStateT (0, []) $ do
  let releasePending = do
        lift . yield =<< uses _2 reverse
        _1 .= 0
        _2 .= []

      addMessage msg = do
        _1 += B.length msg
        _2 %= (msg:)

      loop = do
        mMsg <- lift await
        case mMsg of
          Nothing -> releasePending
          Just msg -> do
            pendingSize <- use _1
            when (pendingSize + B.length msg > maxBundleSize) releasePending
            addMessage msg
            loop
  loop

loadKafka :: String -> FilePath -> IO ()
loadKafka topic file = do
  withBinaryFile file ReadMode $ \h -> do
    hSetBuffering h . BlockBuffering . Just $ 1024 * 1024
    res <- runKafkaConfigured "queryStrato" . runConduit $
         streamFile h
      .| bundleMessages
      .| mapMC (produceBytes' topic)
      .| mapC filterResponse
      .| mapM_C (\errs -> unless (null errs) . liftIO . die . printf "errors from kafka: %s" $ show errs)

    either (die . show) return res


verifyKafkaFile :: FilePath -> IO ()
verifyKafkaFile file = do
  withBinaryFile file ReadMode $ \h -> do
    hSetBuffering h . BlockBuffering . Just $ 1024 * 1024
    (msgsRead, bytesRead) :: (Int, Int) <- flip execStateT (0, 0) . runConduit $
         streamFile h
      .| iterMC (\_ -> _1 += 1)
      .| iterMC (\msg -> _2 += B.length msg)
      .| mapM_C (\msg -> use _1 >>= \idx -> liftIO (printf "Read message #%d: %d bytes\n" idx (B.length msg)))
    printf "%d messages read, %d bytes read\n" msgsRead bytesRead
