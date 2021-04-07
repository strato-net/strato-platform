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
                     | WSIAddWatches [T.Text]
                     | WSIRemoveWatches [T.Text]
                     | WSIClearWatches
                     deriving (Eq, Show, Generic, ToJSON, FromJSON)

data WSDebuggerOutput = WSOStatus DebuggerStatus
                      | WSOStackTrace [SourcePos]
                      | WSOVariables (M.Map T.Text (M.Map T.Text T.Text))
                      | WSOWatches (M.Map T.Text T.Text)
                      | WSOBreakpoints [Breakpoint]
                      deriving (Eq, Show, Generic, ToJSON, FromJSON)