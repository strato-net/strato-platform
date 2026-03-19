{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Init.BuildMetadata
  ( version
  , hashStrato
  , hashMercataBackend
  , hashMercataUi
  , hashSmd
  , hashApex
  , hashPostgrest
  , hashNginx
  , hashPrometheus
  ) where

import Blockchain.Init.BuildMetadata.TH (getValue)

version :: String
version = $(getValue "VERSION")

hashStrato :: String
hashStrato = $(getValue "HASH_STRATO")

hashMercataBackend :: String
hashMercataBackend = $(getValue "HASH_MERCATA_BACKEND")

hashMercataUi :: String
hashMercataUi = $(getValue "HASH_MERCATA_UI")

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
