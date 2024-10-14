{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Strato.Indexer.TxrIndexer (
  TxrResult(..),
  txrIndexerMainLoop,
  indexEventToTxrResults
  ) where

import BlockApps.Logging
import BlockApps.X509.Certificate
import Blockchain.Data.ChainInfoDB (addMember, removeMember, terminateChain)
import Blockchain.Data.DataDefs (EventDB (..), LogDB (..), TransactionResult (..))
import qualified Blockchain.Data.LogDB as LogDB
import Blockchain.Data.TransactionDef (formatChainId)
import Blockchain.Data.ValidatorRef
import Blockchain.Strato.Indexer.IContext
import Blockchain.Strato.Indexer.Kafka
import Blockchain.Strato.Indexer.Model
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainMember
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Validator (Validator(..))
import qualified Blockchain.Strato.RedisBlockDB as RBDB
import Conduit
import Control.Monad
import Control.Monad.Composable.Kafka
import Control.Monad.Composable.Redis
import Control.Monad.Composable.SQL
import qualified Data.ByteString.Char8 as C8
import Data.Either.Extra (eitherToMaybe)
import qualified Data.List as List
import Data.Maybe (fromMaybe, maybeToList)
import qualified Data.Text as T
import Text.Format

logF :: MonadLogger m => [String] -> m ()
logF = $logInfoS "txrIndexer" . T.pack . concat

doAddOrgName :: (MonadLogger m, HasKafka m, HasRedis m, HasSQL m) =>
                Word256 -> ChainMemberParsedSet -> m ()
doAddOrgName chainId cm = do
  logF
    [ "Adding chain ",
      formatChainId $ Just chainId,
      " to cm ",
      format cm
    ]
  addMember chainId cm
  void . execRedis $ RBDB.addChainMember chainId cm

doRemoveOrgName :: (MonadLogger m, HasRedis m, HasSQL m) =>
                   Word256 -> ChainMemberParsedSet -> m ()
doRemoveOrgName chainId cm = do
  logF
    [ "Removing chain ",
      formatChainId $ Just chainId,
      " from org ",
      format cm
    ]
  removeMember chainId cm
  void . execRedis $ RBDB.removeChainMember chainId cm

doRegisterCertificate :: (MonadLogger m, HasKafka m, HasRedis m) =>
                         Address -> X509CertInfoState -> m ()
doRegisterCertificate userAddress x509CertInfoState = do
  logF
    [ "Registering X.509 Certificate -- key/userAddress: ",
      format userAddress,
      "; value/x509CertInfoState: ",
      format x509CertInfoState
    ]
  void . execRedis $ RBDB.registerCertificate userAddress x509CertInfoState

doRevokeCertificate :: (MonadLogger m, HasKafka m, HasRedis m) =>
                       Address -> m ()
doRevokeCertificate userAddress = do
  logF
    [ "Revoking X.509 Certificate -- key/userAddress: ",
      format userAddress
    ]
  void . execRedis $ RBDB.revokeCertificate userAddress

doValidatorAdded :: (MonadLogger m, HasKafka m, HasRedis m, HasSQL m) =>
                    Keccak256 -> Validator -> m ()
doValidatorAdded bHash cm = do
  logF
    [ "Adding validator ",
      format cm,
      " at block ",
      format bHash
    ]
  addRemoveValidator ([], [cm])
  void . execRedis $ RBDB.addValidators [cm]

doValidatorRemoved :: (MonadLogger m, HasKafka m, HasRedis m, HasSQL m) =>
                      Keccak256 -> Validator -> m ()
doValidatorRemoved bHash cm = do
  logF
    [ "Removing validator ",
      format cm,
      " at block ",
      format bHash
    ]
  addRemoveValidator ([cm], [])
  void . execRedis $ RBDB.removeValidators [cm]

txrIndexerMainLoop :: (MonadLogger m, HasKafka m, HasRedis m, HasSQL m) =>
                      m ()
txrIndexerMainLoop = forever $ do
  consume "txrIndexer" "strato-txr-indexer" targetTopicName $ \() idxEvents -> do
    runConduit $ yieldMany idxEvents .| process .| output
    return ()
  where
    process = awaitForever $ yieldMany . indexEventToTxrResults
    output = awaitForever $ lift . txrResultHandler

data TxrResult
  = AddOrgName Word256 ChainMemberParsedSet
  | RemoveOrgName Word256 ChainMemberParsedSet
  | RegisterCertificate Address X509CertInfoState
  | CertificateRevoked Address
  | ValidatorAdded Keccak256 Validator
  | ValidatorRemoved Keccak256 Validator
  | TerminateChain Word256
  | PutLogDB LogDB
  | PutEventDB EventDB
  | PutTxResult TransactionResult
  | Failure String
  deriving (Show, Eq)

indexEventToTxrResults :: IndexEvent -> [TxrResult]
indexEventToTxrResults = \case
  EventDBEntry ev -> (:) (PutEventDB ev) . maybeToList $
    case (_accountAddress $ eventDBContractAddress ev, eventDBChainId ev, eventDBName ev, eventDBArgs ev) of
      (Address 0x100, Just chainId, "OrgAdded", [o]) -> Just . AddOrgName chainId $ Org (T.pack o) True
      (Address 0x100, Just chainId, "OrgUnitAdded", [o, u]) -> Just . AddOrgName chainId $ OrgUnit (T.pack o) (T.pack u) True
      (Address 0x100, Just chainId, "CommonNameAdded", [o, u, c]) -> Just . AddOrgName chainId $ CommonName (T.pack o) (T.pack u) (T.pack c) True
      (Address 0x100, Just chainId, "OrgRemoved", [o]) -> Just . RemoveOrgName chainId $ Org (T.pack o) False
      (Address 0x100, Just chainId, "OrgUnitRemoved", [o, u]) -> Just . RemoveOrgName chainId $ OrgUnit (T.pack o) (T.pack u) False
      (Address 0x100, Just chainId, "CommonNameRemoved", [o, u, c]) -> Just . RemoveOrgName chainId $ CommonName (T.pack o) (T.pack u) (T.pack c) False
      (Address 0x100, Nothing, "ValidatorAdded", [_, _, c]) -> Just . ValidatorAdded (eventDBBlockHash ev) $ Validator $ T.pack c
      (Address 0x100, Nothing, "ValidatorRemoved", [_, _, c]) -> Just . ValidatorRemoved (eventDBBlockHash ev) $ Validator $ T.pack c
      (Address 0x509, Nothing, "CertificateRegistered", [certString]) ->
        let cert = bsToCert . C8.pack $ certString
            userAddress = fmap (fromPublicKey . subPub) $ getCertSubject =<< eitherToMaybe cert
            org = maybe "" subOrg $ getCertSubject =<< eitherToMaybe cert
            orgUnit = fromMaybe Nothing $ Just . subUnit =<< getCertSubject =<< eitherToMaybe cert
            commonName = maybe "" subCommonName $ getCertSubject =<< eitherToMaybe cert
         in case (cert, userAddress) of
              (Left s, Nothing) -> Just . Failure $ "Failed to parse the certString for the CertificateRegistered event: " <> s
              (Left s, Just ua) -> Just . Failure $ "Failed to parse the certString for the CertificateRegistered event: " <> s <> "; " <> show ua
              (Right s, Nothing) -> Just . Failure $ "Failed to parse the certString's userAddress for the CertificateRegistered event: " <> show s
              (Right c, Just ua) -> Just $ RegisterCertificate ua X509CertInfoState {userAddress = ua, certificate = c, isValid = True, children = [], orgName = org, orgUnit = orgUnit, commonName = commonName}
      (Address 0x509, Nothing, "CertificateRevoked", [userAddress]) ->
        let userAddress' = stringAddress userAddress
         in case userAddress' of
              Nothing -> Just . Failure $ "Failed to parse the certString for the CertificateRevoked event: " <> userAddress
              Just ua -> Just $ CertificateRevoked ua
      _ -> Nothing
  TxResult r -> [PutTxResult r]
  _ -> []

txrResultHandler :: (MonadLogger m, HasKafka m, HasRedis m, HasSQL m) =>
                    TxrResult -> m ()
txrResultHandler = \case
  AddOrgName chainId chainMember -> doAddOrgName chainId chainMember
  RemoveOrgName chainId chainMember -> doRemoveOrgName chainId chainMember
  RegisterCertificate ua certInfoState -> doRegisterCertificate ua certInfoState
  CertificateRevoked userAddress -> doRevokeCertificate userAddress
  TerminateChain chainId -> terminateChain chainId
  ValidatorAdded bHash chainMember -> doValidatorAdded bHash chainMember
  ValidatorRemoved bHash chainMember -> doValidatorRemoved bHash chainMember
  PutLogDB l -> do
    logF
      [ "Inserting LogDB entry for tx: ",
        format $ logDBTransactionHash l,
        " on chain ",
        formatChainId $ logDBChainId l,
        " at block ",
        format $ logDBBlockHash l
      ]
    void $ LogDB.putLogDB l
  PutEventDB ev -> do
    let evName = eventDBName ev
        evArgs = eventDBArgs ev
    logF
      [ "Inserting EventDB entry for Event: ",
        evName,
        " with args: ",
        List.intercalate "," evArgs,
        " for chainID: ",
        formatChainId $ eventDBChainId ev
      ]
  PutTxResult _ -> return () --do
  Failure err -> $logErrorS "txrIndexer" $ T.pack err

--    logF [ "Inserting TXResult for tx "
--         , format $ transactionResultTransactionHash r
--         , " at block "
--         , format $ transactionResultBlockHash r
--         ]
--    void $ TxrDB.putTransactionResult r
