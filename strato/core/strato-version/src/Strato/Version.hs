{-# LANGUAGE TemplateHaskell #-}

module Strato.Version 
  ( stratoVersion
  , stratoVersionTag
  ) where

import Strato.Version.TH (getVersionValue)

stratoVersionTag :: String
stratoVersionTag = $(getVersionValue "VERSION")
{-# NOINLINE stratoVersionTag #-}

stratoVersion :: String
stratoVersion = stratoVersionTag
{-# NOINLINE stratoVersion #-}
