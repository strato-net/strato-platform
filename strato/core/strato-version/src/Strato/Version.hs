{-# LANGUAGE CPP #-}
{-# LANGUAGE TemplateHaskell #-}

module Strato.Version 
  ( stratoVersion
  , stratoVersionTag
  ) where

#ifndef VERSION
import Strato.Version.TH (getVersionValue)
#endif

#define STRINGIFY(x) #x
#define STR(x) STRINGIFY(x)

stratoVersionTag :: String
#ifdef VERSION
stratoVersionTag = STR(VERSION)
#else
stratoVersionTag = $(getVersionValue "VERSION")
#endif
{-# NOINLINE stratoVersionTag #-}

stratoVersion :: String
stratoVersion = stratoVersionTag
{-# NOINLINE stratoVersion #-}
