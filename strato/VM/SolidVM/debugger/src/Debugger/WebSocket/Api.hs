{-# LANGUAGE DataKinds         #-} -- DEBUGGING
{-# LANGUAGE LambdaCase        #-} -- DEBUGGING
{-# LANGUAGE RecordWildCards   #-} -- DEBUGGING
{-# LANGUAGE TypeOperators     #-} -- DEBUGGING
{-# LANGUAGE DeriveAnyClass    #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}

module Debugger.WebSocket.Api where

import           Data.Aeson
import qualified Data.Map.Strict        as M
import qualified Data.Text              as T
import           GHC.Generics
import           Debugger.Types

data WSDebuggerInput = WSIStatus
                     | WSIPause
                     | WSIResume
                     | WSIGetBreakpoints
                     | WSIAddBreakpoints [Breakpoint]
                     | WSIRemoveBreakpoints [Breakpoint]
                     | WSIClearBreakpoints
                     | WSIClearBreakpointsPath [T.Text]
                     | WSIStepIn
                     | WSIStepOver
                     | WSIStepOut
                     | WSIGetStackTrace
                     | WSIGetVariables
                     | WSIGetWatches
                     | WSIAddWatches [EvaluationRequest]
                     | WSIRemoveWatches [EvaluationRequest]
                     | WSIClearWatches
                     deriving (Eq, Show, Generic, ToJSON, FromJSON)

data WSDebuggerOutput = WSOStatus DebuggerStatus
                      | WSOStackTrace [SourcePosition]
                      | WSOVariables (M.Map T.Text (M.Map T.Text EvaluationResponse))
                      | WSOWatches (M.Map EvaluationRequest EvaluationResponse)
                      | WSOBreakpoints [Breakpoint]
                      deriving (Eq, Show, Generic, ToJSON, FromJSON)