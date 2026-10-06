{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE ScopedTypeVariables #-}

-- | Delivery of vm-runner responses to the request handlers waiting for them.
--
-- Every JSON-RPC call that needs the VM (eth_call, eth_getBalance,
-- strato_simulate*, debug traces, ...) writes a 'JsonRpcCommand' to the VM
-- task topic and waits for the matching 'JsonRpcResponse' on the
-- @jsonrpcresponse@ topic. That topic is consumed exactly once per process by
-- the dispatcher started with 'startResponseDispatcher', which hands each
-- response to the handler that registered for its id via
-- 'withPendingResponse'.
--
-- Historically every request ran its own 'consumeFromLatest' on the topic.
-- That was fine on the Kafka backend, where each call kept a private offset
-- starting at the latest message. On the JLog backend all calls share the one
-- durable subscriber (@ethereum-jsonrpc_latest@) and every batch a waiter read
-- was checkpointed for all of them, so concurrent requests consumed each
-- other's responses and timed out with "timeout waiting for vm-runner
-- response".
module ResponseDispatcher
  ( startResponseDispatcher,
    withPendingResponse,
  )
where

import Blockchain.EthConf (runStreamMConfigured)
import Control.Concurrent (forkIO, myThreadId, threadDelay)
import Control.Concurrent.MVar
import Control.Exception (SomeAsyncException, SomeException, bracket, evaluate, fromException, throwIO, try)
import Control.Monad (forever, void)
import Control.Monad.Composable.Base (runEff)
import Control.Monad.Composable.Streaming (consumeFromLatest)
import Control.Monad.IO.Class (MonadIO, liftIO)
import qualified Data.ByteString as B
import Data.IORef
import qualified Data.Map.Strict as M
import GHC.Conc (labelThread)
import System.IO (hPutStrLn, stderr)
import System.IO.Unsafe (unsafePerformIO)

-- | Handlers waiting for a response, keyed by request id.
pendingResponses :: IORef (M.Map String (MVar B.ByteString))
pendingResponses = unsafePerformIO $ newIORef M.empty
{-# NOINLINE pendingResponses #-}

-- | Register interest in the response to @rpcId@ for the duration of the
-- action. Register before the command is written to the VM task topic, so a
-- fast response cannot arrive before anyone is waiting for it. The slot is
-- removed again on every exit path, including a timeout.
withPendingResponse :: String -> (MVar B.ByteString -> IO a) -> IO a
withPendingResponse rpcId =
  bracket
    ( do
        slot <- newEmptyMVar
        atomicModifyIORef' pendingResponses $ \m -> (M.insert rpcId slot m, ())
        return slot
    )
    (\_ -> atomicModifyIORef' pendingResponses $ \m -> (M.delete rpcId m, ()))

-- | Start the single consumer of the @jsonrpcresponse@ topic in a background
-- thread. Responses for ids nobody is waiting for any more (the caller timed
-- out) are dropped. If the underlying stream fails, the error is logged and
-- the stream reopened; an undecodable message is logged and skipped rather
-- than blocking the stream.
startResponseDispatcher :: IO ()
startResponseDispatcher = void . forkIO $ do
  tid <- myThreadId
  labelThread tid "jsonrpcResponseDispatcher"
  forever $ do
    result <-
      try . runEff $
        runStreamMConfigured "ethereum-jsonrpc" $
          consumeFromLatest "jsonrpcresponse" (return ()) deliver
    case result of
      Left e
        | Just (ae :: SomeAsyncException) <- fromException e -> throwIO ae
        | otherwise ->
            hPutStrLn stderr $
              "jsonrpcResponseDispatcher: response stream failed, reopening in 1s: " ++ show e
      Right () ->
        hPutStrLn stderr "jsonrpcResponseDispatcher: response stream ended, reopening in 1s"
    threadDelay 1000000
  where
    deliver :: MonadIO m => [(String, B.ByteString)] -> m (Maybe ())
    deliver responses = do
      liftIO $ mapM_ deliverOne responses
      return Nothing

    deliverOne :: (String, B.ByteString) -> IO ()
    deliverOne item = do
      -- Items are decoded lazily by the consumer; force this one here so a
      -- malformed message is skipped instead of taking the dispatcher down.
      forced <- try $ do
        let (rpcId, bytes) = item
        _ <- evaluate (length rpcId)
        _ <- evaluate (B.length bytes)
        return (rpcId, bytes)
      case forced of
        Left (e :: SomeException) ->
          hPutStrLn stderr $ "jsonrpcResponseDispatcher: dropping undecodable response: " ++ show e
        Right (rpcId, bytes) -> do
          mSlot <- atomicModifyIORef' pendingResponses $ \m ->
            case M.lookup rpcId m of
              Just slot -> (M.delete rpcId m, Just slot)
              Nothing -> (m, Nothing)
          maybe (return ()) (\slot -> void $ tryPutMVar slot bytes) mSlot
