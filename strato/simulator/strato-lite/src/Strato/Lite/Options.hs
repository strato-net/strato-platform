{-# LANGUAGE TemplateHaskell #-}

module Strato.Lite.Options where

import HFlags

defineFlag "port" (8051 :: Int) "Port for running REST debugger session"
defineFlag "nodes" "[[\"Boot\", {\"orgName\":\"BlockApps\",\"orgUnit\":\"Engineering\",\"commonName\":\"Admin\"}, \"127.0.0.1\"]]" "Initial node list"
defineFlag "connections" "[]" "Initial connections list"
