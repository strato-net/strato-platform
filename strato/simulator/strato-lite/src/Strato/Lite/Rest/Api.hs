{-# LANGUAGE DataKinds         #-} -- DEBUGGING
{-# LANGUAGE LambdaCase        #-} -- DEBUGGING
{-# LANGUAGE RecordWildCards   #-} -- DEBUGGING
{-# LANGUAGE TypeOperators     #-} -- DEBUGGING
{-# LANGUAGE DeriveAnyClass    #-}
{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}

module Strato.Lite.Rest.Api
  ( ThreadResultMap
  , StratoLiteRestAPI
  , stratoLiteRestAPI
  ) where

import qualified Data.Map.Strict as M
import qualified Data.Text       as T
import           Servant
import           Blockchain.Data.Json

type ThreadResultMap = M.Map T.Text (Maybe (Either String ()))

type StratoLiteRestAPI = GetNodes
                    :<|> GetConnections
                    :<|> PostAddNode
                    :<|> PostRemoveNode
                    :<|> PostAddConnection
                    :<|> PostRemoveConnection
                    :<|> PostTimeout
                    :<|> PostTx

type GetNodes = "nodes" :> Get '[JSON] ThreadResultMap
type GetConnections = "connections" :> Get '[JSON] ThreadResultMap
type PostAddNode = "node" :> Capture "nodeLabel" T.Text 
                          :> "add"
                          :> ReqBody '[JSON] T.Text
                          :> Post '[JSON] Bool
type PostRemoveNode = "node" :> Capture "nodeLabel" T.Text
                             :> "remove"
                             :> Post '[JSON] Bool
type PostAddConnection = "connection" :> Capture "server" T.Text
                                      :> Capture "client" T.Text
                                      :> "add"
                                      :> Post '[JSON] Bool
type PostRemoveConnection = "connection" :> Capture "server" T.Text
                                         :> Capture "client" T.Text
                                         :> "remove"
                                         :> Post '[JSON] Bool
type PostTimeout = "timeout" :> ReqBody '[JSON] Int :> Post '[JSON] ()
type PostTx = "tx" :> ReqBody '[JSON] Transaction' :> Post '[JSON] ()
-- type PutPause = "pause" :> Put '[JSON] DebuggerStatus
-- type PutResume = "resume" :> Put '[JSON] DebuggerStatus
-- type GetBreakpoints = "breakpoints" :> Get '[JSON] [Breakpoint]
-- type PutBreakpoints = "breakpoints" :> ReqBody '[JSON] [Breakpoint] :> Put '[JSON] DebuggerStatus
-- type DeleteBreakpoints = "breakpoints" :> ReqBody '[JSON] [Breakpoint] :> Delete '[JSON] DebuggerStatus
-- type DeleteBreakpointsPath = "breakpoints" :> Capture "file" T.Text :> Delete '[JSON] DebuggerStatus
-- type PostStepIn = "step-in" :> Post '[JSON] DebuggerStatus
-- type PostStepOver = "step-over" :> Post '[JSON] DebuggerStatus
-- type PostStepOut = "step-out" :> Post '[JSON] DebuggerStatus
-- type GetStackTrace = "stack-trace" :> Get '[JSON] [SourcePosition]
-- type GetVariables = "variables" :> Get '[JSON] (M.Map T.Text (M.Map T.Text EvaluationResponse))
-- type GetWatches = "watches" :> Get '[JSON] (M.Map EvaluationRequest EvaluationResponse)
-- type PutWatches = "watches" :> ReqBody '[JSON] [EvaluationRequest] :> Put '[JSON] DebuggerStatus
-- type DeleteWatches = "watches" :> ReqBody '[JSON] [EvaluationRequest] :> Delete '[JSON] DebuggerStatus
-- type PostEvals = "eval" :> ReqBody '[JSON] [EvaluationRequest] :> Post '[JSON] [EvaluationResponse]

stratoLiteRestAPI :: Proxy StratoLiteRestAPI
stratoLiteRestAPI = Proxy