{-# LANGUAGE DataKinds         #-} -- DEBUGGING
{-# LANGUAGE LambdaCase        #-} -- DEBUGGING
{-# LANGUAGE RecordWildCards   #-} -- DEBUGGING
{-# LANGUAGE TypeOperators     #-} -- DEBUGGING
{-# LANGUAGE DeriveAnyClass    #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}

module Debugger.Server where

import           Control.Monad
import           Control.Monad.IO.Class
import qualified Data.Set               as S
import qualified Data.Text              as T
import           UnliftIO.STM
import           Debugger.Types

status :: MonadIO m => DebugSettings -> m DebuggerStatus
status DebugSettings{..} = do
  mCurrent <- atomically $ readTVar current
  case mCurrent of
    Nothing -> pure Running
    Just dbgst -> pure $ Paused dbgst

pause :: MonadIO m => DebugSettings -> m DebuggerStatus
pause dSettings@DebugSettings{..} = do
  void . atomically $ do
    writeTVar operation Pause
    readTVar current
  status dSettings

resume :: MonadIO m => DebugSettings -> m DebuggerStatus
resume dSettings@DebugSettings{..} = do
  void . atomically $ do
    writeTVar operation Run
    writeTVar current Nothing
  status dSettings

stepIn :: MonadIO m => DebugSettings -> m DebuggerStatus
stepIn dSettings@DebugSettings{..} = do
  void . atomically $ writeTVar operation StepIn
  status dSettings

stepOver :: MonadIO m => DebugSettings -> m DebuggerStatus
stepOver dSettings@DebugSettings{..} = do
  void . atomically $ do
    mCurrent <- readTVar current
    case mCurrent of
      Nothing -> writeTVar operation Run
      Just (DebugState _ cStack _ _) -> writeTVar operation (StepOver $ length cStack)
  status dSettings

stepOut :: MonadIO m => DebugSettings -> m DebuggerStatus
stepOut dSettings@DebugSettings{..} = do
  void . atomically $ do
    mCurrent <- readTVar current
    case mCurrent of
      Nothing -> writeTVar operation Run
      Just (DebugState _ cStack _ _) -> writeTVar operation (StepOut $ length cStack)
  status dSettings

getBreakpoints :: MonadIO m => DebugSettings -> m [Breakpoint]
getBreakpoints DebugSettings{..} = fmap S.toList . atomically $ readTVar breakpoints

addBreakpoints :: MonadIO m => [Breakpoint] -> DebugSettings -> m DebuggerStatus
addBreakpoints bPoints dSettings@DebugSettings{..} = do
  void . atomically $ do
    modifyTVar breakpoints $ \bps -> foldr S.insert bps bPoints
  status dSettings

removeBreakpoints :: MonadIO m => [Breakpoint] -> DebugSettings -> m DebuggerStatus
removeBreakpoints bPoints dSettings@DebugSettings{..} = do
  void . atomically $ do
    modifyTVar breakpoints $ \bps -> case bPoints of
      [] -> S.empty
      bPoints' -> foldr S.delete bps bPoints'
  status dSettings

removeBreakpointsPath :: MonadIO m => [T.Text] -> DebugSettings -> m DebuggerStatus
removeBreakpointsPath paths dSettings@DebugSettings{..} = do
  void . atomically $ do
    modifyTVar breakpoints $ \bps ->
      let pathsSet = S.fromList $ T.unpack <$> paths
          bpf ps (UnconditionalBP loc) = not $ sourceName loc `S.member` ps
          bpf ps (ConditionalBP loc _) = not $ sourceName loc `S.member` ps
          bpf _ _ = True
       in S.filter (bpf pathsSet) bps
  status dSettings

addWatches :: MonadIO m => [T.Text] -> DebugSettings -> m DebuggerStatus
addWatches watches dSettings@DebugSettings{..} = do
  void . atomically $ do
    modifyTVar watchExpressions $ \wes -> foldr S.insert wes watches
  status dSettings

removeWatches :: MonadIO m => [T.Text] -> DebugSettings -> m DebuggerStatus
removeWatches watches dSettings@DebugSettings{..} = do
  void . atomically $ do
    modifyTVar watchExpressions $ \wes -> case watches of
      [] -> S.empty
      watches' -> foldr S.delete wes watches'
  status dSettings