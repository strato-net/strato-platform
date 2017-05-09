{-# LANGUAGE TemplateHaskell #-}

module Blockchain.ServOptions where

import           HFlags

defineFlag "a:address" ("127.0.0.1" :: String) "Connect to server at address"
defineFlag "l:listen" (30303 :: Int) "Listen on port"
defineFlag "runUDPServer" True "Turn the UDP server on/off"
defineFlag "networkID" (1::Int) "Turn the UDP server on/off"
defineFlag "name" ("Indiana Jones" :: String) "Who to greet."

