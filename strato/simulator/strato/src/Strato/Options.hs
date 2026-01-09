{-# LANGUAGE TemplateHaskell #-}

module Strato.Options where

import HFlags

defineFlag "directory" ("~/.strato" :: String) "Directory where blockchain data should be stored"
defineFlag "private_key" ("strato.pem" :: String) "Path to private key file"
defineFlag "username" ("strato_user" :: String) "Username"
defineFlag "backend_port" (3031 :: Int) "Username"
defineFlag "frontend_port" (3030 :: Int) "Username"
defineFlag "no_backend" False "Whether to run the app with a backend node or not"
defineFlag "gui" False "Whether to run the app headless or with a native GUI"
defineFlag "in_memory" False "Whether to run the app using an in-memory DB or filesystem DB (LevelDB)"
defineFlag "wipe" False "Whether to wipe the node instead of run it"
defineFlag "resync" False "Whether to wipe the node before running it"
defineFlag "l:logs" "" "Which log file to tail"
defineFlag "t:tail" False "Whether to tail logs"