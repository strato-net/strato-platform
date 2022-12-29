{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE LambdaCase        #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell   #-}
module Blockchain.Strato.Indexer.TxrIndexer where

import           Conduit
import           Control.Monad
import qualified Data.ByteString.Char8              as C8
import           Data.Either.Extra                  (eitherToMaybe)
import qualified Data.List                          as List
import           Data.Maybe                         (maybeToList, fromMaybe)
import qualified Data.Text                          as T
import qualified Data.Set                           as S
import           Network.Kafka
import           Blockchain.MilenaTools
import           Network.Kafka.Protocol

import           BlockApps.X509.Certificate
import           BlockApps.Logging
import           Blockchain.Data.ChainInfoDB        (addMember, removeMember, terminateChain)
import           Blockchain.Data.DataDefs           (LogDB (..), EventDB (..), TransactionResult (..))
import qualified Blockchain.Data.LogDB              as LogDB
import           Blockchain.Data.TransactionDef     (formatChainId)
import           Blockchain.EthConf                 (lookupConsumerGroup)

import           Blockchain.Sequencer.Event
import           Blockchain.Sequencer.Kafka
import           Blockchain.Strato.Indexer.IContext
import           Blockchain.Strato.Indexer.Kafka
import           Blockchain.Strato.Indexer.Model
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.ChainMember
import           Blockchain.Strato.Model.ExtendedWord
import           Blockchain.Strato.Model.Keccak256
import qualified Blockchain.Strato.RedisBlockDB     as RBDB

import           Text.Format

addTopic :: Keccak256
addTopic = hash $ C8.pack "MemberAdded(address,string)"

removeTopic :: Keccak256
removeTopic = hash $ C8.pack "MemberRemoved(address)"

terminateTopic :: Keccak256
terminateTopic = hash $ C8.pack "ChainTerminated()"

logF :: MonadLogger m => [String] -> m ()
logF = $logInfoS "txrIndexer" . T.pack . concat

doAddOrgName :: Word256 -> ChainMemberParsedSet -> IContextM ()
doAddOrgName chainId cm = do
  logF [ "Adding chain "
       , formatChainId $ Just chainId
       , " to cm "
       , format cm
       ]
  lift $ addMember chainId cm
  void . RBDB.withRedisBlockDB $ RBDB.addChainMember chainId (ChainMembers $ S.singleton cm)
  void . withKafkaRetry1s $ writeUnseqEvents [IENewChainOrgName chainId cm]

doRemoveOrgName :: Word256 -> ChainMemberParsedSet -> IContextM ()
doRemoveOrgName chainId cm = do
  logF [ "Removing chain "
       , formatChainId $ Just chainId
       , " from org "
       , format cm
       ]
  lift $ removeMember chainId cm
  void . RBDB.withRedisBlockDB $ RBDB.removeOrgNameChain (ChainMembers $ S.singleton cm) chainId

doRegisterCertificate :: Address -> X509CertInfoState -> IContextM ()
doRegisterCertificate userAddress x509CertInfoState = do
  logF [ "Registering X.509 Certificate -- key/userAddress: "
       , format userAddress
       , "; value/x509CertInfoState: "
       , format x509CertInfoState
       ]
  void . RBDB.withRedisBlockDB $ RBDB.registerCertificate userAddress x509CertInfoState
  void . withKafkaRetry1s $ writeUnseqEvents [IENewCertRegistered userAddress x509CertInfoState]

doRevokeCertificate :: Address -> IContextM ()
doRevokeCertificate userAddress = do
  logF [ "Revoking X.509 Certificate -- key/userAddress: "
        , format userAddress
        ]
  void . RBDB.withRedisBlockDB $ RBDB.revokeCertificate userAddress
  void . withKafkaRetry1s $ writeUnseqEvents [IECertRevoked userAddress]

txrIndexer :: LoggingT IO ()
txrIndexer = runIContextM "strato-txr-indexer" . forever $ do
    $logInfoS "txrIndexer" "About to fetch IndexEvents"
    (offset, idxEvents) <- getUnprocessedIndexEvents
    logF ["Fetched ", show (length idxEvents), " events starting from ", show offset]
    runConduit $ yieldMany idxEvents .| process .| output
    let nextOffset' = offset + fromIntegral (length idxEvents)
    setKafkaCheckpoint nextOffset'
  where process = awaitForever $ yieldMany . indexEventToTxrResults
        output = awaitForever $ lift . txrResultHandler


data TxrResult = AddOrgName (Either String (Word256, ChainMemberParsedSet))
               | RemoveOrgName (Either String (Word256, ChainMemberParsedSet))
               | RegisterCertificate (Either String (Address, X509CertInfoState))
               | CertificateRevoked (Either String Address)
               | TerminateChain (Either String Word256)
               | PutLogDB LogDB
               | PutEventDB EventDB
               | PutTxResult TransactionResult
               deriving (Show, Eq)

indexEventToTxrResults :: IndexEvent -> [TxrResult]
indexEventToTxrResults = \case
  EventDBEntry ev -> (:) (PutEventDB ev) . maybeToList $
     case (_accountAddress $ eventDBContractAddress ev, eventDBChainId ev, eventDBName ev, eventDBArgs ev) of
      (Address 0x100, Just chainId, "OrgAdded", [o]) -> Just . AddOrgName $ Right (chainId, (Org (T.pack o) True))
      (Address 0x100, Just chainId, "OrgUnitAdded", [o, u]) -> Just . AddOrgName $ Right (chainId, (OrgUnit (T.pack o) (T.pack u) True))
      (Address 0x100, Just chainId, "CommonNameAdded", [o, u, c]) -> Just . AddOrgName $ Right (chainId, (CommonName (T.pack o) (T.pack u) (T.pack c) True))
      (Address 0x100, Just chainId, "OrgRemoved", [o]) -> Just . AddOrgName $ Right (chainId, (Org (T.pack o) False))
      (Address 0x100, Just chainId, "OrgUnitRemoved", [o, u]) -> Just . AddOrgName $ Right (chainId, (OrgUnit (T.pack o) (T.pack u) False))
      (Address 0x100, Just chainId, "CommonNameRemoved", [o, u, c]) -> Just . AddOrgName $ Right (chainId, (CommonName (T.pack o) (T.pack u) (T.pack c) False))
      (Address 0x509, Nothing, "CertificateRegistered", [certString]) ->
        let cert = bsToCert . C8.pack $ certString
            userAddress = fmap (fromPublicKey . subPub) $ getCertSubject =<< eitherToMaybe cert
            org = maybe "" subOrg $ getCertSubject =<< eitherToMaybe cert
            orgUnit = fromMaybe Nothing $ Just . subUnit =<< getCertSubject =<< eitherToMaybe cert
            commonName = maybe "" subCommonName $ getCertSubject =<< eitherToMaybe cert
        in case (cert, userAddress) of
            (Left s, Nothing) -> Just . RegisterCertificate . Left $ "Failed to parse the certString for the CertificateRegistered event: " <> s
            (Left s, Just ua) -> Just . RegisterCertificate . Left $ "Failed to parse the certString for the CertificateRegistered event: " <> s <> "; " <> show ua
            (Right s, Nothing) -> Just . RegisterCertificate . Left $ "Failed to parse the certString's userAddress for the CertificateRegistered event: " <> show s
            (Right c, Just ua) -> Just . RegisterCertificate . Right $ (ua, X509CertInfoState{userAddress=ua, certificate=c, isValid=True, children=[],orgName=org, orgUnit=orgUnit, commonName=commonName})
      (Address 0x509, Nothing, "CertificateRevoked", [userAddress]) ->
        let userAddress' = stringAddress userAddress
        in case userAddress' of
            Nothing -> Just . CertificateRevoked . Left $ "Failed to parse the certString for the CertificateRevoked event: " <> userAddress
            Just ua -> Just . CertificateRevoked $ Right ua
      _ -> Nothing
  TxResult r -> [PutTxResult r]
  _ -> []

txrResultHandler :: TxrResult -> IContextM ()
txrResultHandler = \case
  AddOrgName e -> case e of
    Right (chainId, chainMember) -> doAddOrgName chainId chainMember
    Left err -> $logErrorS "txrIndexer" $ T.pack err
  RemoveOrgName e -> case e of
    Right (chainId, chainMember) -> doRemoveOrgName chainId chainMember
    Left err -> $logErrorS "txrIndexer" $ T.pack err
  RegisterCertificate e -> case e of
    Right (ua, certInfoState) -> doRegisterCertificate ua certInfoState
    Left err -> $logErrorS "txrIndexer" $ T.pack err
  CertificateRevoked e -> case e of
    Right userAddress -> doRevokeCertificate userAddress
    Left err -> $logErrorS "txrIndexer" $ T.pack err
  TerminateChain e -> case e of
    Right chainId -> lift $ terminateChain chainId
    Left err -> $logErrorS "txrIndexer" $ T.pack err
  PutLogDB l -> do
    logF [ "Inserting LogDB entry for tx: "
         , format $ logDBTransactionHash l
         , " on chain "
         , formatChainId $ logDBChainId l
         , " at block "
         , format $ logDBBlockHash l
         ]
    void . lift $ LogDB.putLogDB l
  PutEventDB ev -> do
    let evName = eventDBName ev
        evArgs = eventDBArgs ev
    logF [ "Inserting EventDB entry for Event: "
         , evName
         , " with args: "
         , List.intercalate "," evArgs
         , " for chainID: "
         , formatChainId $ eventDBChainId ev
         ]
  PutTxResult _ -> return () --do
--    logF [ "Inserting TXResult for tx "
--         , format $ transactionResultTransactionHash r
--         , " at block "
--         , format $ transactionResultBlockHash r
--         ]
--    void . lift $ TxrDB.putTransactionResult r

kafkaClientIds :: (KafkaClientId, ConsumerGroup)
kafkaClientIds = ("strato-txr-indexer", lookupConsumerGroup "strato-txr-indexer")

getKafkaCheckpoint :: IContextM Offset
getKafkaCheckpoint = withKafkaRetry1s (fetchSingleOffset (snd kafkaClientIds) targetTopicName 0) >>= \case
    Left UnknownTopicOrPartition -> setKafkaCheckpoint 0 >> getKafkaCheckpoint
    Left err -> error $ "Unexpected response when fetching offset for " ++ show targetTopicName ++ ": " ++ show err
    Right (ofs, _)  -> return ofs

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
