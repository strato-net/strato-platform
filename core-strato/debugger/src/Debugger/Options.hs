{-# LANGUAGE TemplateHaskell #-}

module Debugger.Options (
  flags_debugEnabled,
  flags_wsDebug,
  flags_debugPort,
  flags_debugWSPort
  ) where

import           HFlags

defineFlag "debugEnabled" (False::Bool) "Whether to run a debugging session"
defineFlag "wsDebug" (False::Bool) "Whether to run a debugging session using WebSockets in addition to the REST API"
defineFlag "debugPort" (8051::Int) "Port for running REST debugger session"
defineFlag "debugWSPort" (8052::Int) "Port for running WS debugger session"

