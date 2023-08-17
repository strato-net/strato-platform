-- DEBUGGING
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
-- DEBUGGING
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
-- DEBUGGING
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
-- DEBUGGING
{-# LANGUAGE TypeOperators #-}

module Debugger.Server where

import Control.Monad
import Control.Monad.IO.Class
import Data.Foldable (traverse_)
import qualified Data.Set as S
import qualified Data.Text as T
import Data.Traversable (for)
import Debugger.Options
import Debugger.Types
import Debugger.Util
import UnliftIO

status :: MonadIO m => DebugSettings -> m DebuggerStatus
status DebugSettings {..} = atomically $ readTVar current

pause :: MonadIO m => DebugSettings -> m DebuggerStatus
pause dSettings@DebugSettings {..} = do
  void . atomically $ writeTChan operation Pause
  status dSettings

resume :: MonadIO m => DebugSettings -> m DebuggerStatus
resume dSettings@DebugSettings {..} = do
  void . atomically $ writeTChan operation Run
  status dSettings

stepIn :: MonadIO m => DebugSettings -> m DebuggerStatus
stepIn dSettings@DebugSettings {..} = do
  void . atomically $ writeTChan operation StepIn
  status dSettings

stepOver :: MonadIO m => DebugSettings -> m DebuggerStatus
stepOver dSettings@DebugSettings {..} = do
  void . atomically $ writeTChan operation StepOver
  status dSettings

stepOut :: MonadIO m => DebugSettings -> m DebuggerStatus
stepOut dSettings@DebugSettings {..} = do
  void . atomically $ writeTChan operation StepOut
  status dSettings

getBreakpoints :: MonadIO m => DebugSettings -> m [Breakpoint]
getBreakpoints DebugSettings {..} = fmap S.toList . atomically $ readTVar breakpoints

addBreakpoints :: MonadIO m => [Breakpoint] -> DebugSettings -> m DebuggerStatus
addBreakpoints bPoints dSettings@DebugSettings {..} = do
  void . atomically $ do
    modifyTVar breakpoints $ \bps -> foldr S.insert bps bPoints
  status dSettings

removeBreakpoints :: MonadIO m => [Breakpoint] -> DebugSettings -> m DebuggerStatus
removeBreakpoints bPoints dSettings@DebugSettings {..} = do
  void . atomically $ do
    modifyTVar breakpoints $ \bps -> case bPoints of
      [] -> S.empty
      bPoints' -> foldr S.delete bps bPoints'
  status dSettings

removeBreakpointsPath :: MonadIO m => [T.Text] -> DebugSettings -> m DebuggerStatus
removeBreakpointsPath paths dSettings@DebugSettings {..} = do
  void . atomically $ do
    modifyTVar breakpoints $ \bps ->
      let pathsSet = S.fromList $ T.unpack <$> paths
          bpf ps (UnconditionalBP loc) = not $ _sourcePositionName loc `S.member` ps
          bpf ps (ConditionalBP loc _) = not $ _sourcePositionName loc `S.member` ps
          bpf _ _ = True
       in S.filter (bpf pathsSet) bps
  status dSettings

addWatches :: MonadIO m => [T.Text] -> DebugSettings -> m DebuggerStatus
addWatches watches dSettings@DebugSettings {..} = do
  void . atomically $ do
    modifyTVar watchExpressions $ \wes -> foldr S.insert wes watches
  status dSettings

removeWatches :: MonadIO m => [T.Text] -> DebugSettings -> m DebuggerStatus
removeWatches watches dSettings@DebugSettings {..} = do
  void . atomically $ do
    modifyTVar watchExpressions $ \wes -> case watches of
      [] -> S.empty
      watches' -> foldr S.delete wes watches'
  status dSettings

postEvalRequests :: MonadIO m => [T.Text] -> DebugSettings -> m [(TMVar EvaluationRequest, TMVar EvaluationResponse)]
postEvalRequests exprs DebugSettings {..} = atomically $ do
  rs <- for exprs $ \expr -> (,) <$> newTMVar expr <*> newEmptyTMVar
  traverse_ (writeTChan requests) rs
  pure rs

evaluateExpressionsWithTimeout :: MonadUnliftIO m => Int -> [T.Text] -> DebugSettings -> m [Maybe EvaluationResponse]
evaluateExpressionsWithTimeout t exprs dSettings = do
  rs <- postEvalRequests exprs dSettings
  getResponsesSync t rs

evaluateExpressions :: MonadUnliftIO m => [T.Text] -> DebugSettings -> m [Maybe EvaluationResponse]
evaluateExpressions = evaluateExpressionsWithTimeout (flags_evalTimeout * microsecondsPerSecond)
