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

module Blockchain.ValidatorDB
  ( isValidator,
    addValidators,
    getValidatorAddresses,
  )
where

import BlockApps.X509.Certificate
import Blockchain.Strato.Model.Address
import qualified Blockchain.Strato.Model.ChainMember as CM
import Blockchain.Strato.RedisBlockDB.Models as Models
import Blockchain.Strato.Model.Validator (Validator(..))
import qualified Data.ByteString.Char8 as S8
import Data.Maybe (catMaybes)
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

isValidator ::
  CM.ChainMemberParsedSet ->
  Redis Bool
isValidator (CM.CommonName _ _ v _) =
  sismember (namespaceToKeyPrefix Validators) (toValue (Validator v)) >>= \case
    Right b -> pure b
    _ -> pure False
isValidator _ = pure False

getValidatorAddresses :: Redis [Address]
getValidatorAddresses = do 
  smembers (namespaceToKeyPrefix Validators) >>= \case 
    Left _ -> pure []
    Right keysBS -> (fmap userAddress . catMaybes) <$> (sequence $ (getCertFromValidator . fromValue) <$> keysBS)

addValidators ::
  [Validator] ->
  Redis (Either Reply Status)
addValidators [] = pure $ Right Ok
addValidators vals =
  sadd (namespaceToKeyPrefix Validators) (toValue <$> vals) >>= \case
    Right _ -> pure $ Right Ok
    Left reply -> pure $ Left reply

getCertFromValidator :: Validator -> Redis (Maybe X509CertInfoState)
getCertFromValidator (Validator v) =
  getInNamespace ParsedSetToX509 (CM.CommonName "" "" v True) >>= \case
    Right (Just state) ->
      let certInfoState = fromValue state
       in pure $ Just certInfoState
    _ -> pure $ Nothing

getInNamespace ::
  (RedisDBKeyable key) =>
  BlockDBNamespace ->
  key ->
  Redis (Either Reply (Maybe S8.ByteString))
getInNamespace ns key = get $ inNamespace ns key
