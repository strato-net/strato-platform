{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Init.BuildMetadata
  ( version
  , hashStrato
  , hashAppBackend
  , hashAppUi
  , hashSmd
  , hashApex
  , hashPostgrest
  , hashNginx
  , hashPrometheus
  , hashLocalAuth
  ) where

import Blockchain.Init.BuildMetadata.TH (getValue)

version :: String
version = $(getValue "VERSION")

hashStrato :: String
hashStrato = $(getValue "HASH_STRATO")

hashAppBackend :: String
hashAppBackend = $(getValue "HASH_APP_BACKEND")

hashAppUi :: String
hashAppUi = $(getValue "HASH_APP_UI")

hashSmd :: String
hashSmd = $(getValue "HASH_SMD")

hashApex :: String
hashApex = $(getValue "HASH_APEX")

hashPostgrest :: String
hashPostgrest = $(getValue "HASH_POSTGREST")

hashNginx :: String
hashNginx = $(getValue "HASH_NGINX")

hashPrometheus :: String
hashPrometheus = $(getValue "HASH_PROMETHEUS")

hashLocalAuth :: String
hashLocalAuth = $(getValue "HASH_LOCAL_AUTH")
