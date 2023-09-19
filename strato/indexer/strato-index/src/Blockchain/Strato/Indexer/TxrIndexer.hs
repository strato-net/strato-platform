{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Strato.Indexer.TxrIndexer where

import BlockApps.Logging
import BlockApps.X509.Certificate
import Blockchain.Data.ChainInfoDB (addMember, removeMember, terminateChain)
import Blockchain.Data.DataDefs (EventDB (..), LogDB (..), TransactionResult (..))
import qualified Blockchain.Data.LogDB as LogDB
import Blockchain.Data.TransactionDef (formatChainId)
import Blockchain.Data.ValidatorRef
import Blockchain.EthConf (lookupConsumerGroup)
import Blockchain.MilenaTools
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka
import Blockchain.Strato.Indexer.IContext
import Blockchain.Strato.Indexer.Kafka
import Blockchain.Strato.Indexer.Model
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainMember
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import qualified Blockchain.Strato.RedisBlockDB as RBDB
import Conduit
import Control.Monad
import qualified Data.ByteString.Char8 as C8
import Data.Either.Extra (eitherToMaybe)
import qualified Data.List as List
import Data.Maybe (fromMaybe, maybeToList)
import qualified Data.Text as T
import Network.Kafka
import Network.Kafka.Protocol
import Text.Format

logF :: MonadLogger m => [String] -> m ()
logF = $logInfoS "txrIndexer" . T.pack . concat

doAddOrgName :: Word256 -> ChainMemberParsedSet -> IContextM ()
doAddOrgName chainId cm = do
  logF
    [ "Adding chain ",
      formatChainId $ Just chainId,
      " to cm ",
      format cm
    ]
  lift $ addMember chainId cm
  void . RBDB.withRedisBlockDB $ RBDB.addChainMember chainId cm
  void . withKafkaRetry1s $ writeUnseqEvents [IENewChainOrgName chainId cm]

doRemoveOrgName :: Word256 -> ChainMemberParsedSet -> IContextM ()
doRemoveOrgName chainId cm = do
  logF
    [ "Removing chain ",
      formatChainId $ Just chainId,
      " from org ",
      format cm
    ]
  lift $ removeMember chainId cm
  void . RBDB.withRedisBlockDB $ RBDB.removeChainMember chainId cm

doRegisterCertificate :: Address -> X509CertInfoState -> IContextM ()
doRegisterCertificate userAddress x509CertInfoState = do
  logF
    [ "Registering X.509 Certificate -- key/userAddress: ",
      format userAddress,
      "; value/x509CertInfoState: ",
      format x509CertInfoState
    ]
  void . RBDB.withRedisBlockDB $ RBDB.registerCertificate userAddress x509CertInfoState
  void . withKafkaRetry1s $ writeUnseqEvents [IENewCertRegistered userAddress x509CertInfoState]

doRevokeCertificate :: Address -> IContextM ()
doRevokeCertificate userAddress = do
  logF
    [ "Revoking X.509 Certificate -- key/userAddress: ",
      format userAddress
    ]
  void . RBDB.withRedisBlockDB $ RBDB.revokeCertificate userAddress
  void . withKafkaRetry1s $ writeUnseqEvents [IECertRevoked userAddress]

doValidatorAdded :: Keccak256 -> ChainMemberParsedSet -> IContextM ()
doValidatorAdded bHash cm = do
  logF
    [ "Adding validator ",
      format cm,
      " at block ",
      format bHash
    ]
  lift $ addRemoveValidator ([], [cm])
  void . RBDB.withRedisBlockDB $ RBDB.addValidators [cm]
  void . withKafkaRetry1s $ writeUnseqEvents [IEValidatorAdded bHash cm]

doValidatorRemoved :: Keccak256 -> ChainMemberParsedSet -> IContextM ()
doValidatorRemoved bHash cm = do
  logF
    [ "Removing validator ",
      format cm,
      " at block ",
      format bHash
    ]
  lift $ addRemoveValidator ([cm], [])
  void . RBDB.withRedisBlockDB $ RBDB.removeValidators [cm]
  void . withKafkaRetry1s $ writeUnseqEvents [IEValidatorRemoved bHash cm]

txrIndexer :: LoggingT IO ()
txrIndexer = runIContextM "strato-txr-indexer" . forever $ do
  $logInfoS "txrIndexer" "About to fetch IndexEvents"
  (offset, idxEvents) <- getUnprocessedIndexEvents
  logF ["Fetched ", show (length idxEvents), " events starting from ", show offset]
  runConduit $ yieldMany idxEvents .| process .| output
  let nextOffset' = offset + fromIntegral (length idxEvents)
  setKafkaCheckpoint nextOffset'
  where
    process = awaitForever $ yieldMany . indexEventToTxrResults
    output = awaitForever $ lift . txrResultHandler

data TxrResult
  = AddOrgName Word256 ChainMemberParsedSet
  | RemoveOrgName Word256 ChainMemberParsedSet
  | RegisterCertificate Address X509CertInfoState
  | CertificateRevoked Address
  | ValidatorAdded Keccak256 ChainMemberParsedSet
  | ValidatorRemoved Keccak256 ChainMemberParsedSet
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
      (Address 0x100, Nothing, "ValidatorAdded", [o, u, c]) -> Just . ValidatorAdded (eventDBBlockHash ev) $ CommonName (T.pack o) (T.pack u) (T.pack c) True
      (Address 0x100, Nothing, "ValidatorRemoved", [o, u, c]) -> Just . ValidatorRemoved (eventDBBlockHash ev) $ CommonName (T.pack o) (T.pack u) (T.pack c) True
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

txrResultHandler :: TxrResult -> IContextM ()
txrResultHandler = \case
  AddOrgName chainId chainMember -> doAddOrgName chainId chainMember
  RemoveOrgName chainId chainMember -> doRemoveOrgName chainId chainMember
  RegisterCertificate ua certInfoState -> doRegisterCertificate ua certInfoState
  CertificateRevoked userAddress -> doRevokeCertificate userAddress
  TerminateChain chainId -> lift $ terminateChain chainId
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
    void . lift $ LogDB.putLogDB l
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
--    void . lift $ TxrDB.putTransactionResult r

kafkaClientIds :: (KafkaClientId, ConsumerGroup)
kafkaClientIds = ("strato-txr-indexer", lookupConsumerGroup "strato-txr-indexer")

getKafkaCheckpoint :: IContextM Offset
getKafkaCheckpoint =
  withKafkaRetry1s (fetchSingleOffset (snd kafkaClientIds) targetTopicName 0) >>= \case
    Left UnknownTopicOrPartition -> setKafkaCheckpoint 0 >> getKafkaCheckpoint
    Left err -> error $ "Unexpected response when fetching offset for " ++ show targetTopicName ++ ": " ++ show err
    Right (ofs, _) -> return ofs

setKafkaCheckpoint :: Offset -> IContextM ()
setKafkaCheckpoint ofs = do
  $logInfoS "setKafkaCheckpoint" . T.pack $ "Setting checkpoint to " ++ show ofs
  withKafkaRetry1s (commitSingleOffset (snd kafkaClientIds) targetTopicName 0 ofs "") >>= \case
    Left err -> error $ "Unexpected response when setting checkpoint to " ++ show ofs ++ ": " ++ show err
    Right () -> return ()

getUnprocessedIndexEvents :: IContextM (Offset, [IndexEvent])
getUnprocessedIndexEvents = do
  ofs <- getKafkaCheckpoint
  evs <- withKafkaRetry1s (readIndexEvents ofs)
  return (ofs, evs)
