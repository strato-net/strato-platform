{-# LANGUAGE TemplateHaskell #-}

module Executable.Options where

import           HFlags


defineFlag "vaultWrapperUrl" ("http://vault-proxy:8000/strato/v2.3" :: String) "Vault-Wrapper URL"

$(return [])
