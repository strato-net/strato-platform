{-# LANGUAGE CPP #-}
{-# LANGUAGE TemplateHaskell #-}

module Strato.Version 
  ( stratoVersion
  , stratoVersionTag
  ) where

#ifndef VERSION
import Strato.Version.TH (getVersionValue)
#endif

stratoVersionTag :: String
#ifdef VERSION
stratoVersionTag = VERSION
#else
stratoVersionTag = $(getVersionValue "VERSION")
#endif
{-# NOINLINE stratoVersionTag #-}

stratoVersion :: String
stratoVersion = stratoVersionTag
{-# NOINLINE stratoVersion #-}
