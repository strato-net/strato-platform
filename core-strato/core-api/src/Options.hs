{-# LANGUAGE TemplateHaskell #-}

module Options where

import           HFlags

defineFlag "appFetchLimit" (100 :: Int) "Maximum number of items returned in queries"

