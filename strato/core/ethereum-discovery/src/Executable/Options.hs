{-# LANGUAGE TemplateHaskell #-}

module Executable.Options where

import           HFlags


defineFlag "vaultWrapperUrl" ("http://strato:8013/strato/v2.3" :: String) "Vault-Wrapper URL"

$(return [])
