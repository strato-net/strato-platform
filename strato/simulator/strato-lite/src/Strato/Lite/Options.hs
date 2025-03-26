{-# LANGUAGE TemplateHaskell #-}

module Strato.Lite.Options where

import HFlags

defineFlag "port" (8051 :: Int) "Port for running REST debugger session"
defineFlag "nodes" "[[\"Boot\", \"Admin\", \"1.2.3.4\"]]" "Initial node list"
defineFlag "connections" "[]" "Initial connections list"
