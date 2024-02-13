{-# LANGUAGE TemplateHaskell #-}

module Debugger.Options where

import HFlags

defineFlag "debugEnabled" (False :: Bool) "Whether to run a debugging session"
defineFlag "debugPort" (8051 :: Int) "Port for running REST debugger session"
defineFlag "debugWSHost" ("127.0.0.1" :: String) "Hostname for running WS debugger session"
defineFlag "debugWSPort" (8052 :: Int) "Port for running WS debugger session"
defineFlag "evalTimeout" (60 :: Int) "number of seconds to wait for eval requests before timing out"
