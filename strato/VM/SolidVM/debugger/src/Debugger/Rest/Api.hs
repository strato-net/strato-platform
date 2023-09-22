-- DEBUGGING
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE FlexibleContexts #-}
-- DEBUGGING
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
-- DEBUGGING
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
-- DEBUGGING
{-# LANGUAGE TypeOperators #-}

module Debugger.Rest.Api
  ( RestDebuggerAPI,
    restDebuggerAPI,
  )
where

import qualified Data.Map.Strict as M
import Data.Source
import qualified Data.Text as T
import Debugger.Types
import Servant

type RestDebuggerAPI =
  GetStatus
    :<|> PutPause
    :<|> PutResume
    :<|> GetBreakpoints
    :<|> PutBreakpoints
    :<|> DeleteBreakpoints
    :<|> DeleteBreakpointsPath
    :<|> PostStepIn
    :<|> PostStepOver
    :<|> PostStepOut
    :<|> GetStackTrace
    :<|> GetVariables
    :<|> GetWatches
    :<|> PutWatches
    :<|> DeleteWatches
    :<|> PostEvals

type GetStatus = "status" :> Get '[JSON] DebuggerStatus

type PutPause = "pause" :> Put '[JSON] DebuggerStatus

type PutResume = "resume" :> Put '[JSON] DebuggerStatus

type GetBreakpoints = "breakpoints" :> Get '[JSON] [Breakpoint]

type PutBreakpoints = "breakpoints" :> ReqBody '[JSON] [Breakpoint] :> Put '[JSON] DebuggerStatus

type DeleteBreakpoints = "breakpoints" :> ReqBody '[JSON] [Breakpoint] :> Delete '[JSON] DebuggerStatus

type DeleteBreakpointsPath = "breakpoints" :> Capture "file" T.Text :> Delete '[JSON] DebuggerStatus

type PostStepIn = "step-in" :> Post '[JSON] DebuggerStatus

type PostStepOver = "step-over" :> Post '[JSON] DebuggerStatus

type PostStepOut = "step-out" :> Post '[JSON] DebuggerStatus

type GetStackTrace = "stack-trace" :> Get '[JSON] [SourcePosition]

type GetVariables = "variables" :> Get '[JSON] (M.Map T.Text (M.Map T.Text EvaluationResponse))

type GetWatches = "watches" :> Get '[JSON] (M.Map EvaluationRequest EvaluationResponse)

type PutWatches = "watches" :> ReqBody '[JSON] [EvaluationRequest] :> Put '[JSON] DebuggerStatus

type DeleteWatches = "watches" :> ReqBody '[JSON] [EvaluationRequest] :> Delete '[JSON] DebuggerStatus

type PostEvals = "eval" :> ReqBody '[JSON] [EvaluationRequest] :> Post '[JSON] [EvaluationResponse]

restDebuggerAPI :: Proxy RestDebuggerAPI
restDebuggerAPI = Proxy
