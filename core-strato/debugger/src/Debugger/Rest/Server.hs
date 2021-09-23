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
import           Control.Monad.IO.Class
import           Data.Aeson             as A
import qualified Data.Map.Strict        as M
import           Data.Maybe             (fromMaybe)
import qualified Data.Text              as T
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
  Paused DebugState{..} -> pure debugStateCallStack
  _ -> pure []

getVariables :: DebugSettings -> Handler (M.Map T.Text (M.Map T.Text EvaluationResponse))
getVariables = status >=> \case
  Paused DebugState{..} -> pure debugStateVariables
  _ -> pure M.empty

getWatches :: DebugSettings -> Handler (M.Map T.Text EvaluationResponse)
getWatches = status >=> \case
  Paused DebugState{..} -> pure debugStateWatches
  _ -> pure M.empty

putWatches :: DebugSettings -> [T.Text] -> Handler DebuggerStatus
putWatches = flip addWatches

deleteWatches :: DebugSettings -> [T.Text] -> Handler DebuggerStatus
deleteWatches = flip removeWatches

postEvals :: DebugSettings -> [EvaluationRequest] -> Handler [EvaluationResponse]
postEvals d ts = fmap (fromMaybe $ Left "") <$> liftIO (evaluateExpressions ts d)

postParse :: ToJSON a
          => (M.Map T.Text T.Text -> a)
          -> M.Map T.Text T.Text
          -> Handler A.Value
postParse parse = pure . toJSON . parse

restDebuggerServer :: ToJSON a
                   => DebugSettings
                   -> (M.Map T.Text T.Text -> a)
                   -> Server RestDebuggerAPI
restDebuggerServer dSettings parse =
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
  :<|> postParse parse

restDebugger :: ToJSON a
             => DebugSettings
             -> (M.Map T.Text T.Text -> a)
             -> Application
restDebugger dSettings parse = serve restDebuggerAPI (restDebuggerServer dSettings parse)