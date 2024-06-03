{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}

module PemOptions where

import Data.Text as T
import HFlags

defineFlag "PEM_FILE" (T.pack "priv.pem" :: Text) "The PEM file which holds the node private key"
defineFlag "port" (8000 :: Int) "The port which the server runs on"
defineFlag "loglevel" (4 :: Int) "The log level for output messages"
