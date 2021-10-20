{-# LANGUAGE DataKinds         #-} -- DEBUGGING
{-# LANGUAGE LambdaCase        #-} -- DEBUGGING
{-# LANGUAGE RecordWildCards   #-} -- DEBUGGING
{-# LANGUAGE TypeOperators     #-} -- DEBUGGING
{-# LANGUAGE DeriveAnyClass    #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}

module Debugger.Rest.Api
  ( RestDebuggerAPI
  , restDebuggerAPI
  , FuzzerArgs(..)
  ) where

import           Data.Aeson      as A
import qualified Data.Map.Strict as M
import           Data.Source
import qualified Data.Text       as T
import           Debugger.Types
import           GHC.Generics
import           Servant

type RestDebuggerAPI = GetStatus
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
                  :<|> PostParse
                  :<|> PostAnalyze
                  :<|> PostFuzz

data FuzzerArgs = FuzzerArgs
  { fuzzerSrc :: SourceMap
  , fuzzerContractName :: T.Text
  , fuzzerCreateArgs :: T.Text
  , fuzzerFuncName :: T.Text
  , fuzzerCallArgs :: T.Text
  } deriving (Eq, Show, Generic, A.ToJSON, A.FromJSON)

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
type PostParse = "parse" :> ReqBody '[JSON] SourceMap :> Post '[JSON] A.Value
type PostAnalyze = "analyze" :> ReqBody '[JSON] SourceMap :> Post '[JSON] [SourceAnnotation (WithSeverity T.Text)]
type PostFuzz = "fuzz" :> ReqBody '[JSON] FuzzerArgs :> Post '[JSON] A.Value

restDebuggerAPI :: Proxy RestDebuggerAPI
restDebuggerAPI = Proxy