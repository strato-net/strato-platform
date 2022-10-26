{-# LANGUAGE TemplateHaskell #-}

module Strato.Lite.Options where

import           HFlags

defineFlag "port" (8051::Int) "Port for running REST debugger session"
defineFlag "nodes" "[[\"Boot\", \"1.2.3.4\"], [\"Node1\", \"5.6.7.8\"], [\"Node2\", \"9.10.11.12\"], [\"Node3\", \"13.14.15.16\"]]" "Initial node list"
defineFlag "connections" "[[\"Boot\", \"Node1\"], [\"Node1\", \"Node2\"], [\"Node2\", \"Node3\"]]" "Initial connections list"