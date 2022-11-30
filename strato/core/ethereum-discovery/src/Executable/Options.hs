{-# LANGUAGE TemplateHaskell #-}

module Executable.Options where

import           HFlags

defineFlag "VAULT_PROXY_PORT" (8013 :: Int) "This is the port that the vault proxy will listen on."
defineFlag "VAULT_PROXY_URL" (T.pack "http://strato" :: Text) "This is the url that the vault proxy will listen on."

$(return [])
