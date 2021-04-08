{-# LANGUAGE DataKinds         #-} -- DEBUGGING
{-# LANGUAGE LambdaCase        #-} -- DEBUGGING
{-# LANGUAGE RecordWildCards   #-} -- DEBUGGING
{-# LANGUAGE TypeOperators     #-} -- DEBUGGING
{-# LANGUAGE DeriveAnyClass    #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}

module Debugger.Rest.Server where

import           Control.Monad
import qualified Data.Map.Strict   as M
import qualified Data.Text         as T
import           Debugger.Rest.Api
import           Debugger.Server
import           Debugger.Types
import           Servant

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
deleteBreakpointsPath = flip $ removeBreakpointsPath . (:[])

postStepIn :: DebugSettings -> Handler DebuggerStatus
postStepIn = stepIn

postStepOver :: DebugSettings -> Handler DebuggerStatus
postStepOver = stepOver

postStepOut :: DebugSettings -> Handler DebuggerStatus
postStepOut = stepOut

getStackTrace :: DebugSettings -> Handler [SourcePos]
getStackTrace = status >=> \case
  Running -> pure []
  Paused DebugState{..} -> pure debugStateCallStack

getVariables :: DebugSettings -> Handler (M.Map T.Text (M.Map T.Text T.Text))
getVariables = status >=> \case
  Running -> pure M.empty
  Paused DebugState{..} -> pure debugStateVariables

getWatches :: DebugSettings -> Handler (M.Map T.Text T.Text)
getWatches = status >=> \case
  Running -> pure M.empty
  Paused DebugState{..} -> pure debugStateWatches

putWatches :: DebugSettings -> [T.Text] -> Handler DebuggerStatus
putWatches = flip addWatches

deleteWatches :: DebugSettings -> [T.Text] -> Handler DebuggerStatus
deleteWatches = flip removeWatches

restDebuggerServer :: DebugSettings -> Server RestDebuggerAPI
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

restDebugger :: DebugSettings -> Application
restDebugger dSettings = serve restDebuggerAPI (restDebuggerServer dSettings)