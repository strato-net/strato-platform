{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeOperators #-}

module Debugger.Rest.Server where

import Control.Monad
import Control.Monad.IO.Class
import qualified Data.Map.Strict as M
import Data.Maybe (fromMaybe)
import Data.Source
import qualified Data.Text as T
import Debugger.Rest.Api
import Debugger.Server
import Debugger.Types
import Servant

getStatus :: DebugSettings -> Handler DebuggerStatus
getStatus = status

putPause :: DebugSettings -> Handler DebuggerStatus
putPause = pause

putResume :: DebugSettings -> Handler DebuggerStatus
putResume = resume

getBreakpointsHandler :: DebugSettings -> Handler [Breakpoint]
getBreakpointsHandler = getBreakpoints

putBreakpoints :: DebugSettings -> [Breakpoint] -> Handler DebuggerStatus
putBreakpoints = flip addBreakpoints

deleteBreakpoints :: DebugSettings -> [Breakpoint] -> Handler DebuggerStatus
deleteBreakpoints = flip removeBreakpoints

deleteBreakpointsPath :: DebugSettings -> T.Text -> Handler DebuggerStatus
deleteBreakpointsPath = flip $ removeBreakpointsPath . (: [])

postStepIn :: DebugSettings -> Handler DebuggerStatus
postStepIn = stepIn

postStepOver :: DebugSettings -> Handler DebuggerStatus
postStepOver = stepOver

postStepOut :: DebugSettings -> Handler DebuggerStatus
postStepOut = stepOut

getStackTrace :: DebugSettings -> Handler [SourcePosition]
getStackTrace =
  status >=> \case
    Paused DebugState {..} -> pure debugStateCallStack
    _ -> pure []

getVariables :: DebugSettings -> Handler (M.Map T.Text (M.Map T.Text EvaluationResponse))
getVariables =
  status >=> \case
    Paused DebugState {..} -> pure debugStateVariables
    _ -> pure M.empty

getWatches :: DebugSettings -> Handler (M.Map T.Text EvaluationResponse)
getWatches =
  status >=> \case
    Paused DebugState {..} -> pure debugStateWatches
    _ -> pure M.empty

putWatches :: DebugSettings -> [T.Text] -> Handler DebuggerStatus
putWatches = flip addWatches

deleteWatches :: DebugSettings -> [T.Text] -> Handler DebuggerStatus
deleteWatches = flip removeWatches

postEvals :: DebugSettings -> [EvaluationRequest] -> Handler [EvaluationResponse]
postEvals d ts = fmap (fromMaybe $ Left "") <$> liftIO (evaluateExpressions ts d)

restDebuggerServer ::
  DebugSettings ->
  Server RestDebuggerAPI
restDebuggerServer dSettings =
  getStatus dSettings
    :<|> putPause dSettings
    :<|> putResume dSettings
    :<|> getBreakpointsHandler dSettings
    :<|> putBreakpoints dSettings
    :<|> deleteBreakpoints dSettings
    :<|> deleteBreakpointsPath dSettings
    :<|> postStepIn dSettings
    :<|> postStepOver dSettings
    :<|> postStepOut dSettings
    :<|> getStackTrace dSettings
    :<|> getVariables dSettings
    :<|> getWatches dSettings
    :<|> putWatches dSettings
    :<|> deleteWatches dSettings
    :<|> postEvals dSettings

combineProxies :: Proxy a -> Proxy b -> Proxy (a :<|> b)
combineProxies _ _ = Proxy

restDebuggerAnd ::
  HasServer api '[] =>
  Proxy api ->
  (DebugSettings -> Server api) ->
  DebugSettings ->
  Application
restDebuggerAnd otherAPI otherServer dSettings =
  serve (combineProxies restDebuggerAPI otherAPI) (restDebuggerServer dSettings :<|> otherServer dSettings)

restDebugger ::
  DebugSettings ->
  Application
restDebugger dSettings = serve restDebuggerAPI (restDebuggerServer dSettings)
