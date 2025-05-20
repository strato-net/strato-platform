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

module Strato.Lite.Rest.Api
  ( ThreadResult,
    NodeStatus (..),
    ThreadResultMap,
    NodeResultMap,
    AddNodeParams (..),
    StratoLiteRestAPI,
    stratoLiteRestAPI,
  )
where

import Data.Aeson
import qualified Data.Map.Strict as M
import qualified Data.Text as T
import GHC.Generics
import Servant

type ThreadResult = Maybe (Either String ())

data NodeStatus = NodeStatus
  { ip :: T.Text
  , roundNumber :: Integer
  , sequenceNumber :: Integer
  , isValidator :: Bool
  , result :: ThreadResult
  } deriving (Eq, Show, Generic, ToJSON, FromJSON)

type ThreadResultMap = M.Map T.Text ThreadResult
type NodeResultMap = M.Map T.Text NodeStatus

type StratoLiteRestAPI =
  GetNodes
    :<|> GetPeers
    :<|> PostAddNode
    :<|> PostRemoveNode
    :<|> PostTimeout

type GetNodes = "nodes" :> Get '[JSON] NodeResultMap

type GetPeers = "nodes" :> Capture "nodeLabel" T.Text :> "peers" :> Get '[JSON] [T.Text]

type PostAddNode =
  "node" :> Capture "nodeLabel" T.Text
    :> "add"
    :> ReqBody '[JSON] AddNodeParams
    :> Post '[JSON] Bool

type PostRemoveNode =
  "node" :> Capture "nodeLabel" T.Text
    :> "remove"
    :> Post '[JSON] Bool

type PostTimeout = "timeout" :> ReqBody '[JSON] Int :> Post '[JSON] ()

data AddNodeParams = AddNodeParams
  { _ip :: T.Text,
    _identity :: T.Text,
    _bootNodes :: [T.Text]
  }
  deriving (Eq, Show, Generic, ToJSON, FromJSON)

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
