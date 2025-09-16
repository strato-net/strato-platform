{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE MultiWayIf #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

{-# OPTIONS -fno-warn-orphans #-}

module Blockchain.CertificateDB
  ( getCertificate
  )
where

import BlockApps.X509.Certificate
import Blockchain.Strato.Model.Address
import Blockchain.Strato.RedisBlockDB.Models as Models
import qualified Data.ByteString.Char8 as S8
import Database.Redis

inNamespace ::
  RedisDBKeyable k =>
  BlockDBNamespace ->
  k ->
  S8.ByteString
inNamespace ns k = ns' `S8.append` toKey k
  where
    ns' = namespaceToKeyPrefix ns

namespaceToKeyPrefix :: BlockDBNamespace -> S8.ByteString 
namespaceToKeyPrefix ns = case ns of 
  Headers -> "h:"
  Transactions -> "t:"
  Numbers -> "n:"
  Uncles -> "u:"
  Parent -> "p:"
  Children -> "c:"
  Canonical -> "q:"
  Validators -> "validators"
  X509Certificates -> "x509:"
  ParsedSetWhitePage -> "potu:"
  ParsedSetToX509 -> "psx509:"

getCertificate :: Address -> Redis (Maybe X509CertInfoState)
getCertificate userAddress =
  getInNamespace X509Certificates (toKey userAddress) >>= \case
    Left _ -> return Nothing
    Right Nothing -> return Nothing
    Right (Just state) ->
      let certInfoState = fromValue state
       in return (Just certInfoState)

getInNamespace ::
  (RedisDBKeyable key) =>
  BlockDBNamespace ->
  key ->
  Redis (Either Reply (Maybe S8.ByteString))
getInNamespace ns key = get $ inNamespace ns key
