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

module Debugger.Init
  ( initializeDebugger,
    initializeDebuggerSimple,
  )
where

import Control.Concurrent.Async
import Debugger.Options
import Debugger.Rest
import Debugger.Types
import Debugger.WebSocket
import Network.Wai.Handler.Warp
import Servant (Application)
import UnliftIO.STM

initializeDebugger ::
  (DebugSettings -> Application) ->
  IO (Maybe (DebugSettings, IO ()))
initializeDebugger restServer =
  if not flags_debugEnabled
    then pure Nothing
    else do
      dSettings <- atomically newDebugSettings
      let rest = run flags_debugPort $ restServer dSettings
          debuggerRunner = race_ rest $ wsDebugger flags_debugWSHost flags_debugWSPort dSettings
      pure $ Just (dSettings, debuggerRunner)

initializeDebuggerSimple :: IO (Maybe (DebugSettings, IO ()))
initializeDebuggerSimple = initializeDebugger restDebugger
