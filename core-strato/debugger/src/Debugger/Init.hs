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
  ) where

import           Control.Concurrent.Async
import qualified Data.Aeson               as A
import qualified Data.Map.Strict          as M
import qualified Data.Text                as T
import           Debugger.Options
import           Debugger.Rest
import           Debugger.Types
import           Debugger.WebSocket
import           Network.Wai.Handler.Warp
import           UnliftIO.STM

initializeDebugger :: A.ToJSON a => (M.Map T.Text T.Text -> a) -> IO (Maybe (DebugSettings, IO ()))
initializeDebugger parse = if not flags_debugEnabled
  then pure Nothing
  else do
    dSettings <- atomically newDebugSettings
    let debuggerRunner =
          let rest = run flags_debugPort (restDebugger dSettings parse)
           in if flags_wsDebug
                then race_ rest $ wsDebugger flags_debugWSPort dSettings
                else rest
    pure $ Just (dSettings, debuggerRunner)
