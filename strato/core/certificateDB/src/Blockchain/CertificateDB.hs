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
  ( registerCertificate,
    getCertificate,
    insertRootCertificate,
  )
where

import BlockApps.X509.Certificate
import Blockchain.Strato.Model.Address
import qualified Blockchain.Strato.Model.ChainMember as CM
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

registerCertificate :: Address -> X509CertInfoState -> Redis (Either Reply Status)
registerCertificate userAddr x509CertInfoState = do
  parent <- (\ma -> maybe (pure Nothing) getCertificate ma) (getParentUserAddress $ certificate x509CertInfoState)

  -- The certificate registry will always be initialized at 0x509 on the main chain
  let parentIsValid = maybe False isValid parent

  case parent of
    -- The CertificateRegistry is initialized, this event it emitted from the right contract,
    -- and the parent certificate is valid
    Just p | parentIsValid -> do
      res1 <- modifyParsedSetFromCert x509CertInfoState
      res2 <- addParsedSet x509CertInfoState
      res3 <- fmap txToEither . multiExec $ updateParent p >> insertNewX509
      case (res1, res2, res3) of
        (Right _, Right _, Right _) -> pure $ Right Ok
        (Left e1, Left e2, Left e3) -> pure $ Left . SingleLine $ S8.pack (show e1) <> S8.pack (show e2) <> S8.pack (show e3)
        (_, _, _) -> pure $ Left . SingleLine $ "registerCertificate failed."

    -- We can not register this certificate
    _ -> pure . Left . SingleLine $ "registerCertificate - invalid contractAddress, contract is not CertificateRegistry"
  where
    insertNewX509 = set (inNamespace X509Certificates $ toKey userAddr) (toValue x509CertInfoState)
    updateParent p@X509CertInfoState {..} = set (inNamespace X509Certificates userAddress) (toValue p {children = userAddr : children})
    txToEither = \case
      TxSuccess _ -> Right Ok
      TxAborted -> Left . SingleLine $ "registerCertificate - Aborted registering cert"
      TxError e -> Left . SingleLine $ "registerCertificate - Error registering cert " <> S8.pack e

getCertificate :: Address -> Redis (Maybe X509CertInfoState)
getCertificate userAddress =
  getInNamespace X509Certificates (toKey userAddress) >>= \case
    Left _ -> return Nothing
    Right Nothing -> return Nothing
    Right (Just state) ->
      let certInfoState = fromValue state
       in return (Just certInfoState)

insertRootCertificate :: Redis (Either Reply Status)
insertRootCertificate = do
  -- TODO: check if root cert has already been added
  res1 <- modifyParsedSetFromCert rootCertInfoState
  res2 <- addParsedSet rootCertInfoState
  res3 <- fmap txToEither . multiExec $ insertNewX509
  case (res1, res2, res3) of
    (Right _, Right _, Right _) -> pure $ Right Ok
    (Left e1, Left e2, Left e3) -> pure $ Left . SingleLine $ S8.pack (show e1) <> S8.pack (show e2) <> S8.pack (show e3)
    (_, _, _) -> pure $ Left . SingleLine $ "insertRootCertificate failed."
  where
    rootCertInfoState = x509CertToCertInfoState rootCert
    ua = userAddress rootCertInfoState
    insertNewX509 = set (inNamespace X509Certificates $ toKey ua) (toValue rootCertInfoState)
    txToEither = \case
      TxSuccess _ -> Right Ok
      TxAborted -> Left . SingleLine $ "insertRootCertificate - Aborted"
      TxError e -> Left . SingleLine $ "insertRootCertificate - Error " <> S8.pack e

addParsedSet :: X509CertInfoState -> Redis (Either Reply Status)
addParsedSet (X509CertInfoState addr _ _ _ _ _ _) = do
  let setOrg = CM.CommonName addr
      setOrgUnit = CM.CommonName addr
      setCommonName = CM.CommonName addr
  currentUnits <-
    getInNamespace ParsedSetWhitePage setOrg >>= \case
      Right (Just runits) ->
        let units = fromValue runits
         in pure $ units
      _ -> pure $ []
  newUnits <- case setOrgUnit `elem` currentUnits of
    True -> pure $ currentUnits
    False -> pure $ currentUnits ++ [setOrgUnit]
  orgAdd <- multiExec $ set (inNamespace ParsedSetWhitePage setOrg) (toValue newUnits)
  orgRes <- case orgAdd of
    TxSuccess _ -> pure $ Right Ok
    TxAborted -> pure . Left $ SingleLine (S8.pack $ "addParsedSet - Aborted")
    TxError e -> pure . Left $ SingleLine (S8.pack $ "addParsedSet - Error" ++ e)
  currentMems <-
    getInNamespace ParsedSetWhitePage setOrgUnit >>= \case
      Right (Just rmems) ->
        let mems = fromValue rmems
         in pure $ mems
      _ -> pure $ []
  newMems <- case setCommonName `elem` currentMems of
    True -> pure $ currentMems
    False -> pure $ currentMems ++ [setCommonName]
  unitAdd <- multiExec $ set (inNamespace ParsedSetWhitePage setOrgUnit) (toValue newMems)
  unitRes <- case unitAdd of
    TxSuccess _ -> pure $ Right Ok
    TxAborted -> pure . Left $ SingleLine (S8.pack $ "addParsedSet - Aborted")
    TxError e -> pure . Left $ SingleLine (S8.pack $ "addParsedSet - Error" ++ e)
  case (orgRes, unitRes) of
    (Right _, Right _) -> pure $ Right Ok
    (Left e1, Left e2) -> pure $ Left . SingleLine $ S8.pack (show e1) <> S8.pack (show e2)
    (_, _) -> pure $ Left . SingleLine $ "This probably shouldn't happen."

modifyParsedSetFromCert :: X509CertInfoState -> Redis (Either Reply Status)
modifyParsedSetFromCert certInfo@(X509CertInfoState addr _ _ _ _ _ _) = do
  let parsedSet = CM.CommonName addr
  res <- multiExec $ set (inNamespace ParsedSetToX509 parsedSet) (toValue certInfo)
  case res of
    TxSuccess _ -> pure $ Right Ok
    TxAborted -> pure . Left $ SingleLine (S8.pack $ "modifyParsedSetFromCert - Aborted")
    TxError e -> pure . Left $ SingleLine (S8.pack $ "modifyParsedSetFromCert - Error" ++ e)

getInNamespace ::
  (RedisDBKeyable key) =>
  BlockDBNamespace ->
  key ->
  Redis (Either Reply (Maybe S8.ByteString))
getInNamespace ns key = get $ inNamespace ns key
