{-# LANGUAGE CPP #-}
{-# LANGUAGE TemplateHaskell #-}

module Strato.Version 
  ( stratoVersion
  , stratoVersionTag
  ) where

#ifdef VERSION
stratoVersionTag :: String
stratoVersionTag = VERSION
{-# NOINLINE stratoVersionTag #-}

#else
import Strato.Version.TH (getVersionValue)

stratoVersionTag :: String
stratoVersionTag = $(getVersionValue "VERSION")
{-# NOINLINE stratoVersionTag #-}

#endif

stratoVersion :: String
stratoVersion = stratoVersionTag
{-# NOINLINE stratoVersion #-}
