{-# LANGUAGE DataKinds         #-} -- DEBUGGING
{-# LANGUAGE LambdaCase        #-} -- DEBUGGING
{-# LANGUAGE RecordWildCards   #-} -- DEBUGGING
{-# LANGUAGE TypeOperators     #-} -- DEBUGGING
{-# LANGUAGE DeriveAnyClass    #-}
{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}

module Debugger.Init
  ( initializeDebugger
  , initializeDebuggerSimple
  ) where

import           Control.Concurrent.Async
import           Debugger.Options
import           Debugger.Rest
import           Debugger.Types
import           Debugger.WebSocket
import           Network.Wai.Handler.Warp
import           Servant                  (Application)
import           UnliftIO.STM

initializeDebugger :: (DebugSettings -> Application)
                   -> IO (Maybe (DebugSettings, IO ()))
initializeDebugger restServer = if not flags_debugEnabled
  then pure Nothing
  else do
    dSettings <- atomically newDebugSettings
    let debuggerRunner =
          let rest = run flags_debugPort $ restServer dSettings
           in if flags_wsDebug
                then race_ rest $ wsDebugger flags_debugWSPort dSettings
                else rest
    pure $ Just (dSettings, debuggerRunner)

initializeDebuggerSimple :: IO (Maybe (DebugSettings, IO ()))
initializeDebuggerSimple = initializeDebugger restDebugger