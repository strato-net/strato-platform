{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeSynonymInstances #-}

-- | JLog (Journaled Log) streaming backend - embedded, no server required.
--
-- JLog is a file-based persistent queue library from Circonus.
-- Topics map to directories containing segmented log files.
-- Multiple subscribers each track their own checkpoint.
--
-- StreamAddress is (basePath, unused) where basePath is the directory for all topics.
-- Port is ignored since JLog is embedded.

module Control.Monad.Composable.Streaming.JLog (
  -- Core types
  StreamM,
  HasStreaming,
  StreamEnv(..),
  TopicName(..),
  ConsumerGroup,
  ClientId,
  StreamAddress,
  MonadUnliftIO,
  -- Running
  runStreamM,
  runStreamMUsingEnv,
  createStreamEnv,
  closeStreamEnv,
  getStreamEnv,
  -- Producing
  produceItems,
  produceItemsAsJSON,
  -- Consuming
  consume,
  consumeBroadcast,
  runConsume,
  consumeFromLatest,
  -- Topics
  createTopicAndWait,
  createBroadcastTopic,
  -- Conduit
  conduitBatchSource,
  -- Deprecated compatibility
  ProduceResponse(..),
  Offset(..)
  ) where

import Conduit
import Control.Concurrent (threadDelay)
import Control.Exception (bracket)
import Control.Monad (void, forever, when)
import Control.Monad.Composable.Base
import Control.Monad.Reader
import qualified Data.Aeson as JSON
import Data.Binary
import qualified Data.ByteString.Lazy as LBS
import qualified Data.ByteString.Unsafe as BSU
import Data.IORef
import Data.Int (Int64)
import Data.String (IsString)
import Data.Text (Text)
import qualified Data.Text as T
import Foreign.C.String
import Foreign.Marshal.Alloc (alloca)
import Foreign.Ptr (nullPtr, castPtr)
import Foreign.Storable (peek, poke)
import qualified Data.ByteString as BS
import System.Directory (createDirectoryIfMissing)
import System.FilePath ((</>))

import JLog.FFI (JLogId(..), JLogMessage(..), jlog_new, jlog_ctx_init, jlog_ctx_open_writer,
                 jlog_ctx_write, jlog_ctx_close, jlog_ctx_add_subscriber,
                 jlog_ctx_open_reader, jlog_ctx_err_string, jlog_ctx_read_interval,
                 jlog_ctx_read_message, jlog_ctx_read_checkpoint, jlog_ctx_advance_id)

-- Compatibility types
newtype Offset = Offset { unOffset :: Int64 }
  deriving (Show, Eq, Ord)

data ProduceResponse = ProduceResponse
  deriving (Show, Eq)

newtype TopicName = TopicName { unTopicName :: Text }
  deriving (Show, Eq, Ord, IsString)

type ClientId = Text
type StreamAddress = (String, Int)  -- (basePath, unused port)
type ConsumerGroup = Text

type StreamM = ReaderT (IORef StreamEnv)
type HasStreaming m = (MonadIO m, AccessibleEnv (IORef StreamEnv) m)

data StreamEnv = StreamEnv
  { seBasePath :: FilePath
  , seClientId :: Text
  }

createStreamEnv :: MonadIO m => ClientId -> StreamAddress -> m StreamEnv
createStreamEnv clientId (basePath, _port) = liftIO $ do
  createDirectoryIfMissing True basePath
  return $ StreamEnv basePath clientId

getStreamEnv :: HasStreaming m => m StreamEnv
getStreamEnv = do
  ref <- accessEnv
  liftIO $ readIORef ref

runStreamMUsingEnv :: MonadIO m => StreamEnv -> StreamM m a -> m a
runStreamMUsingEnv env f = do
  ref <- liftIO $ newIORef env
  runReaderT f ref

runStreamM :: MonadUnliftIO m => ClientId -> StreamAddress -> StreamM m a -> m a
runStreamM clientId addr f = withRunInIO $ \runInIO -> bracket
  (createStreamEnvIO clientId addr)
  (\_ -> return ())  -- Nothing to close for JLog env
  (\env -> do
    ref <- newIORef env
    runInIO $ runReaderT f ref)

createStreamEnvIO :: ClientId -> StreamAddress -> IO StreamEnv
createStreamEnvIO clientId (basePath, _port) = do
  createDirectoryIfMissing True basePath
  return $ StreamEnv basePath clientId

closeStreamEnv :: MonadIO m => StreamEnv -> m ()
closeStreamEnv _ = return ()  -- JLog contexts are per-operation

----------------------
--    Producing     --
----------------------

produceItems :: (Binary a, HasStreaming m) => TopicName -> [a] -> m [ProduceResponse]
produceItems topicName events = do
  env <- getStreamEnv
  let topicPath = seBasePath env </> T.unpack (unTopicName topicName)
  liftIO $ do
    -- Ensure parent directory exists (but not the topic dir itself - let jlog create it)
    createDirectoryIfMissing True (seBasePath env)
    withCString topicPath $ \cpath -> do
      -- Try to init (creates new log with metastore)
      ctx1 <- jlog_new cpath
      when (ctx1 == nullPtr) $ error "jlog_new failed"
      _ <- jlog_ctx_init ctx1  -- Ignore error if already exists
      jlog_ctx_close ctx1
      
      -- Now open fresh context for writing
      ctx <- jlog_new cpath
      when (ctx == nullPtr) $ error "jlog_new failed (writer)"
      rc <- jlog_ctx_open_writer ctx
      when (rc /= 0) $ do
        errStr <- jlog_ctx_err_string ctx >>= peekCString
        error $ "jlog_ctx_open_writer failed for " ++ topicPath ++ " (rc=" ++ show rc ++ "): " ++ errStr
      mapM_ (writeMessage ctx) events
      jlog_ctx_close ctx
  return [ProduceResponse]
  where
    writeMessage ctx e = do
      let bs = LBS.toStrict $ encode e
      BSU.unsafeUseAsCStringLen bs $ \(ptr, len) ->
        void $ jlog_ctx_write ctx (castPtr ptr) (fromIntegral len)

produceItemsAsJSON :: (JSON.ToJSON a, HasStreaming m) => TopicName -> [a] -> m [ProduceResponse]
produceItemsAsJSON topicName events = do
  env <- getStreamEnv
  let topicPath = seBasePath env </> T.unpack (unTopicName topicName)
  liftIO $ do
    createDirectoryIfMissing True (seBasePath env)
    withCString topicPath $ \cpath -> do
      ctx1 <- jlog_new cpath
      when (ctx1 == nullPtr) $ error "jlog_new failed"
      _ <- jlog_ctx_init ctx1
      jlog_ctx_close ctx1
      
      ctx <- jlog_new cpath
      when (ctx == nullPtr) $ error "jlog_new failed (writer)"
      rc <- jlog_ctx_open_writer ctx
      when (rc /= 0) $ do
        errStr <- jlog_ctx_err_string ctx >>= peekCString
        error $ "jlog_ctx_open_writer failed for " ++ topicPath ++ " (rc=" ++ show rc ++ "): " ++ errStr
      mapM_ (writeMessage ctx) events
      jlog_ctx_close ctx
  return [ProduceResponse]
  where
    writeMessage ctx e = do
      let bs = LBS.toStrict $ JSON.encode e
      BSU.unsafeUseAsCStringLen bs $ \(ptr, len) ->
        void $ jlog_ctx_write ctx (castPtr ptr) (fromIntegral len)

----------------------
--Consuming/Fetching--
----------------------

consume :: (Binary a, HasStreaming m) =>
           ConsumerGroup -> TopicName -> ([a] -> m ()) -> m ()
consume consumerGroup topicName f =
  void $ runConsume consumerGroup topicName (\a -> Nothing <$ f a)

consumeBroadcast :: (Binary a, HasStreaming m) =>
                    ConsumerGroup -> TopicName -> ([a] -> m ()) -> m ()
consumeBroadcast = consume

-- | Batch limits for reading messages
maxBatchMessages :: Int
maxBatchMessages = 1000

maxBatchBytes :: Int
maxBatchBytes = 10 * 1024 * 1024  -- 10 MB

runConsume :: (Binary a, HasStreaming m) =>
              ConsumerGroup -> TopicName -> ([a] -> m (Maybe b)) -> m b
runConsume consumerGroup topicName f = do
  env <- getStreamEnv
  let topicPath = seBasePath env </> T.unpack (unTopicName topicName)
      subscriber = T.unpack consumerGroup
  
  -- Ensure topic exists and subscriber is added
  liftIO $ do
    createDirectoryIfMissing True (seBasePath env)
    withCString topicPath $ \cpath -> do
      ctx <- jlog_new cpath
      when (ctx == nullPtr) $ error "jlog_new failed in runConsume"
      _ <- jlog_ctx_init ctx
      withCString subscriber $ \csub ->
        void $ jlog_ctx_add_subscriber ctx csub 0
      jlog_ctx_close ctx
  
  consumeLoop topicPath subscriber
  where
    consumeLoop topicPath subscriber = do
      -- Read batch without checkpointing, get messages + last ID
      result <- liftIO $ readBatchNoCheckpoint topicPath subscriber
      case result of
        Nothing -> do
          liftIO $ threadDelay 100000  -- 100ms poll if no messages
          consumeLoop topicPath subscriber
        Just (msgs, lastId) -> do
          -- Process batch, then checkpoint once at the end
          mResult <- processBatch msgs
          liftIO $ checkpointTo topicPath subscriber lastId
          case mResult of
            Just r -> return r
            Nothing -> consumeLoop topicPath subscriber
    
    processBatch [] = return Nothing
    processBatch msgs = do
      let items = map (decode . LBS.fromStrict) msgs
      f items
    
    -- Read up to maxBatchMessages or maxBatchBytes, whichever comes first
    -- Returns Nothing if no messages available
    -- Returns Just (messages, lastId) with the ID of last message read
    readBatchNoCheckpoint topicPath subscriber = 
      withCString topicPath $ \cpath ->
        withCString subscriber $ \csub -> do
          ctx <- jlog_new cpath
          if ctx == nullPtr
            then return Nothing
            else do
              rc <- jlog_ctx_open_reader ctx csub
              if rc /= 0
                then do
                  jlog_ctx_close ctx
                  return Nothing
                else 
                  alloca $ \startPtr ->
                    alloca $ \endPtr -> do
                      poke startPtr (JLogId 0 0)
                      poke endPtr (JLogId 0 0)
                      count <- jlog_ctx_read_interval ctx startPtr endPtr
                      if count <= 0
                        then do
                          jlog_ctx_close ctx
                          return Nothing
                        else do
                          startId <- peek startPtr
                          readMessagesWithAdvance ctx startPtr endPtr [] 0 0 startId
    
    -- Read messages using advance_id to iterate without checkpointing
    -- lastReadId tracks the last message we successfully read (for correct checkpointing)
    readMessagesWithAdvance ctx curPtr endPtr acc msgCount totalBytes lastReadId
      | msgCount >= maxBatchMessages = finishBatch ctx lastReadId acc
      | totalBytes >= maxBatchBytes  = finishBatch ctx lastReadId acc
      | otherwise = do
          curId <- peek curPtr
          endId <- peek endPtr
          if curId `idGreaterThan` endId
            then finishBatch ctx lastReadId acc
            else do
              alloca $ \msgStructPtr -> do
                readRc <- jlog_ctx_read_message ctx curPtr msgStructPtr
                if readRc /= 0
                  then finishBatch ctx lastReadId acc
                  else do
                    msg <- peek msgStructPtr
                    let msgLen = jlogMsgLen msg
                        msgDataPtr = jlogMsgData msg
                    if msgDataPtr == nullPtr || msgLen == 0
                      then finishBatch ctx lastReadId acc
                      else do
                        msgBytes <- BS.packCStringLen (castPtr msgDataPtr, fromIntegral msgLen)
                        let newTotal = totalBytes + BS.length msgBytes
                        -- If we just read the last message (cur == end), stop here
                        if curId == endId
                          then finishBatch ctx curId (msgBytes : acc)
                          else do
                            -- Advance to next message
                            alloca $ \nextPtr -> do
                              poke nextPtr =<< peek curPtr  -- Copy cur to next first
                              advRc <- jlog_ctx_advance_id ctx curPtr nextPtr endPtr
                              if advRc /= 0
                                then finishBatch ctx curId (msgBytes : acc)
                                else readMessagesWithAdvance ctx nextPtr endPtr (msgBytes : acc) (msgCount + 1) newTotal curId
    
    idGreaterThan (JLogId l1 m1) (JLogId l2 m2) =
      l1 > l2 || (l1 == l2 && m1 > m2)
    
    finishBatch ctx lastId acc = do
      jlog_ctx_close ctx
      if null acc
        then return Nothing
        else return $ Just (reverse acc, lastId)
    
    -- Checkpoint to a specific ID (single fsync for entire batch)
    checkpointTo topicPath subscriber lastId =
      withCString topicPath $ \cpath ->
        withCString subscriber $ \csub -> do
          ctx <- jlog_new cpath
          when (ctx /= nullPtr) $ do
            rc <- jlog_ctx_open_reader ctx csub
            when (rc == 0) $
              alloca $ \idPtr -> do
                poke idPtr lastId
                void $ jlog_ctx_read_checkpoint ctx idPtr
            jlog_ctx_close ctx

consumeFromLatest :: (Binary a, HasStreaming m) =>
                     TopicName -> m () -> ([a] -> m (Maybe b)) -> m b
consumeFromLatest topicName initAction f = do
  env <- getStreamEnv
  let subscriber = T.unpack (seClientId env) ++ "_latest"
  
  -- Add subscriber at current position
  let topicPath = seBasePath env </> T.unpack (unTopicName topicName)
  liftIO $ do
    createDirectoryIfMissing True (seBasePath env)
    withCString topicPath $ \cpath -> do
      ctx <- jlog_new cpath
      _ <- jlog_ctx_init ctx
      withCString subscriber $ \csub ->
        void $ jlog_ctx_add_subscriber ctx csub 1  -- JLOG_END
      jlog_ctx_close ctx
  
  initAction
  runConsume (T.pack subscriber) topicName f

conduitBatchSource :: (Binary a, MonadIO m) =>
                      ClientId -> StreamAddress -> TopicName -> ConduitT i [a] m b
conduitBatchSource clientId streamAddress topicName = do
  env <- createStreamEnv clientId streamAddress
  let topicPath = seBasePath env </> T.unpack (unTopicName topicName)
      subscriber = T.unpack clientId
  
  -- Ensure topic and subscriber exist
  liftIO $ do
    createDirectoryIfMissing True (seBasePath env)
    withCString topicPath $ \cpath -> do
      ctx <- jlog_new cpath
      _ <- jlog_ctx_init ctx
      withCString subscriber $ \csub ->
        void $ jlog_ctx_add_subscriber ctx csub 0
      jlog_ctx_close ctx
  
  -- Read batches of messages with single checkpoint at end
  forever $ do
    result <- liftIO $ readBatchConduit topicPath subscriber
    case result of
      Nothing -> do
        yield []
        liftIO $ threadDelay 100000
      Just (msgs, lastId) -> do
        liftIO $ checkpointConduit topicPath subscriber lastId
        let items = map (decode . LBS.fromStrict) msgs
        yield items
  where
    readBatchConduit topicPath subscriber = 
      withCString topicPath $ \cpath ->
        withCString subscriber $ \csub -> do
          ctx <- jlog_new cpath
          if ctx == nullPtr
            then return Nothing
            else do
              rc <- jlog_ctx_open_reader ctx csub
              if rc /= 0
                then do
                  jlog_ctx_close ctx
                  return Nothing
                else 
                  alloca $ \startPtr ->
                    alloca $ \endPtr -> do
                      poke startPtr (JLogId 0 0)
                      poke endPtr (JLogId 0 0)
                      count <- jlog_ctx_read_interval ctx startPtr endPtr
                      if count <= 0
                        then do
                          jlog_ctx_close ctx
                          return Nothing
                        else do
                          startId <- peek startPtr
                          readLoopAdvance ctx startPtr endPtr [] 0 0 startId
    
    readLoopAdvance ctx curPtr endPtr acc msgCount totalBytes lastReadId
      | msgCount >= maxBatchMessages = finishConduit ctx lastReadId acc
      | totalBytes >= maxBatchBytes  = finishConduit ctx lastReadId acc
      | otherwise = do
          curId <- peek curPtr
          endId <- peek endPtr
          if curId `idGt` endId
            then finishConduit ctx lastReadId acc
            else do
              alloca $ \msgStructPtr -> do
                readRc <- jlog_ctx_read_message ctx curPtr msgStructPtr
                if readRc /= 0
                  then finishConduit ctx lastReadId acc
                  else do
                    msg <- peek msgStructPtr
                    let msgLen = jlogMsgLen msg
                        msgDataPtr = jlogMsgData msg
                    if msgDataPtr == nullPtr || msgLen == 0
                      then finishConduit ctx lastReadId acc
                      else do
                        msgBytes <- BS.packCStringLen (castPtr msgDataPtr, fromIntegral msgLen)
                        let newTotal = totalBytes + BS.length msgBytes
                        -- If we just read the last message (cur == end), stop here
                        if curId == endId
                          then finishConduit ctx curId (msgBytes : acc)
                          else do
                            alloca $ \nextPtr -> do
                              poke nextPtr =<< peek curPtr  -- Copy cur to next first
                              advRc <- jlog_ctx_advance_id ctx curPtr nextPtr endPtr
                              if advRc /= 0
                                then finishConduit ctx curId (msgBytes : acc)
                                else readLoopAdvance ctx nextPtr endPtr (msgBytes : acc) (msgCount + 1) newTotal curId
    
    idGt (JLogId l1 m1) (JLogId l2 m2) = l1 > l2 || (l1 == l2 && m1 > m2)
    
    finishConduit ctx lastId acc = do
      jlog_ctx_close ctx
      if null acc
        then return Nothing
        else return $ Just (reverse acc, lastId)
    
    checkpointConduit topicPath subscriber lastId =
      withCString topicPath $ \cpath ->
        withCString subscriber $ \csub -> do
          ctx <- jlog_new cpath
          when (ctx /= nullPtr) $ do
            rc <- jlog_ctx_open_reader ctx csub
            when (rc == 0) $
              alloca $ \idPtr -> do
                poke idPtr lastId
                void $ jlog_ctx_read_checkpoint ctx idPtr
            jlog_ctx_close ctx

----------------------
--  Topic creation  --
----------------------

createTopicAndWait :: HasStreaming m => TopicName -> m ()
createTopicAndWait topicName = do
  env <- getStreamEnv
  let topicPath = seBasePath env </> T.unpack (unTopicName topicName)
  
  liftIO $ do
    -- Only create parent dir, let jlog_ctx_init create the topic dir with metastore
    createDirectoryIfMissing True (seBasePath env)
    withCString topicPath $ \cpath -> do
      ctx <- jlog_new cpath
      when (ctx == nullPtr) $ error $ "jlog_new failed for " ++ topicPath
      rc <- jlog_ctx_init ctx
      -- rc == -1 with JLOG_ERR_CREATE_EXISTS is ok - log already initialized
      when (rc /= 0) $ do
        errStr <- jlog_ctx_err_string ctx >>= peekCString
        -- Ignore "already exists" error (JLOG_ERR_CREATE_EXISTS)
        when (errStr /= "JLOG_ERR_CREATE_EXISTS") $
          error $ "jlog_ctx_init failed for " ++ topicPath ++ " (rc=" ++ show rc ++ "): " ++ errStr
      jlog_ctx_close ctx

createBroadcastTopic :: HasStreaming m => TopicName -> m ()
createBroadcastTopic = createTopicAndWait
