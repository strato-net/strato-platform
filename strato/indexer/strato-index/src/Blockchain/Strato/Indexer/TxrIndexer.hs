{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE LambdaCase        #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell   #-}
module Blockchain.Strato.Indexer.TxrIndexer where

import           Conduit
-- import           Control.DeepSeq
-- import           Control.Exception
import           Control.Monad
-- import           Data.Binary
-- import qualified Data.ByteString                    as BS
import qualified Data.ByteString.Char8              as C8
-- import qualified Data.ByteString.Lazy               as BL
import           Data.Either.Extra                  (eitherToMaybe)
import qualified Data.List                          as List
import           Data.Maybe                         (maybeToList, fromMaybe)
import qualified Data.Text                          as T
-- import           Data.Text.Encoding                 (decodeUtf8)
import           Network.Kafka
import           Blockchain.MilenaTools
import           Network.Kafka.Protocol

import qualified Data.Functor.Identity as DFI

import           BlockApps.X509.Certificate
import           BlockApps.Logging
import           Blockchain.Data.ChainInfoDB        (addMember, removeMember, terminateChain)
import           Blockchain.Data.DataDefs           (LogDB (..), EventDB (..), TransactionResult (..))
-- import           Blockchain.Data.Enode
import qualified Blockchain.Data.LogDB              as LogDB
-- import qualified Blockchain.Data.EventDB            as EventDB
import           Blockchain.Data.TransactionDef     (formatChainId)
--import qualified Blockchain.Data.TransactionResult  as TxrDB
import           Blockchain.EthConf                 (lookupConsumerGroup)

import           Blockchain.Sequencer.Event
import           Blockchain.Sequencer.Kafka
import           Blockchain.Strato.Indexer.IContext
import           Blockchain.Strato.Indexer.Kafka
import           Blockchain.Strato.Indexer.Model
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.ExtendedWord
import           Blockchain.Strato.Model.Keccak256
-- import           Blockchain.Strato.Model.Util       (byteString2Integer)
import qualified Blockchain.Strato.RedisBlockDB     as RBDB
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.ChainMember

-- import           System.IO.Unsafe                   (unsafePerformIO)
import           Text.Format

addTopic :: Keccak256
addTopic = hash $ C8.pack "MemberAdded(address,string)"

removeTopic :: Keccak256
removeTopic = hash $ C8.pack "MemberRemoved(address)"

terminateTopic :: Keccak256
terminateTopic = hash $ C8.pack "ChainTerminated()"

logF :: MonadLogger m => [String] -> m ()
logF = $logInfoS "txrIndexer" . T.pack . concat

-- doAddMember :: Word256 -> Address -> Enode -> IContextM ()
-- doAddMember chainId address enode = do
--   logF [ "Adding member "
--        , format address
--        , " on chain "
--        , formatChainId $ Just chainId
--        ]
--    -- We only need the Text version for Postgres
--   void . RBDB.withRedisBlockDB $ RBDB.addChainMember chainId address enode
--   void . withKafkaRetry1s $ writeUnseqEvents [IENewChainMember chainId address enode]

-- doRemoveMember :: Word256 -> Address -> IContextM ()
-- doRemoveMember chainId address = do
--   logF [ "Removing member "
--        , format address
--        , " on chain "
--        , formatChainId $ Just chainId
--        ]
--   void . RBDB.withRedisBlockDB $ RBDB.removeChainMember chainId address

doAddOrgName :: Word256 -> ChainMember -> IContextM ()
doAddOrgName chainId cm = do
  logF [ "Adding chain "
       , formatChainId $ Just chainId
       , " to cm "
       , format cm
       ]
  lift $ addMember chainId cm
  void . RBDB.withRedisBlockDB $ RBDB.addOrgNameChain cm chainId
  void . withKafkaRetry1s $ writeUnseqEvents [IENewChainOrgName chainId cm]

doRemoveOrgName :: Word256 -> ChainMember -> IContextM ()
doRemoveOrgName chainId cm = do
  logF [ "Removing chain "
       , formatChainId $ Just chainId
       , " from org "
       , format cm
       ]
  lift $ removeMember chainId cm
  void . RBDB.withRedisBlockDB $ RBDB.removeOrgNameChain cm chainId

doRegisterCertificate :: Account -> Address -> X509CertInfoState -> IContextM ()
doRegisterCertificate contractAddress userAddress x509CertInfoState = do
  logF [ "Registering X.509 Certificate -- key/userAddress: "
       , format userAddress
       , "; value/x509CertInfoState: "
       , format x509CertInfoState
       ]
  void . RBDB.withRedisBlockDB $ RBDB.registerCertificate contractAddress userAddress x509CertInfoState

doRevokeCertificate :: Account -> Address -> IContextM ()
doRevokeCertificate contractAddress userAddress = do
  logF [ "Revoking X.509 Certificate -- key/userAddress: "
        , format userAddress
        ]
  void . RBDB.withRedisBlockDB $ RBDB.revokeCertificate contractAddress userAddress

doCertificateRegistryInitialized :: Account -> IContextM ()
doCertificateRegistryInitialized contractAddress = do
  logF [ "Initializing Certificate Registry"]
  void . RBDB.withRedisBlockDB $ RBDB.initializeCertificateRegistry contractAddress

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

data TxrResult = 
  -- AddMember (Either String (Word256, Address, Enode))
              --  | RemoveMember (Either String (Word256, Address))
                AddOrgName (Either String (Word256, ChainMember))
               | RemoveOrgName (Either String (Word256, ChainMember))
               | RegisterCertificate (Either String (Account, Address, X509CertInfoState))
               | CertificateRevoked (Either String (Account, Address))
               | CertificateRegistryInitialized (Either String Account)
               | TerminateChain (Either String Word256)
               | PutLogDB LogDB
               | PutEventDB EventDB
               | PutTxResult TransactionResult
               deriving (Show, Eq)

indexEventToTxrResults :: IndexEvent -> [TxrResult] -- emit MemberAdded(address,enode);
indexEventToTxrResults = \case
  -- LogDBEntry l -> (:) (PutLogDB l) . maybeToList $ logDBChainId l >>= \chainId ->
  --   case logDBTopic1 l of
  --     Just x | x == keccak256ToWord256 addTopic ->
  --       let address = decode . BL.fromStrict . BS.take 20 . BS.drop 12 $ logDBTheData l --TODO: unhack
  --           enodelen = fromInteger . byteString2Integer . BS.take 32 . BS.drop 64 $ logDBTheData l
  --           enode' = T.unpack . decodeUtf8 . BS.take enodelen . BS.drop 96 $ logDBTheData l
  --           --TODO: we don't need this powerful of an evaluation, we just need to improve `readEnode`
  --           eEnode :: Either SomeException Enode = unsafePerformIO $ try . evaluate . force $ readEnode enode'
  --        in case eEnode of
  --         Left err -> Just . AddMember . Left $ "failed to parse enode: " ++ show err
  --         Right enode -> Just . AddMember $ Right (chainId, address, enode)
  --     Just x | x == keccak256ToWord256 removeTopic ->
  --       let address = decode . BL.fromStrict . BS.take 20 . BS.drop 12 $ logDBTheData l
  --        in Just . RemoveMember $ Right (chainId, address)
  --     Just x | x == keccak256ToWord256 terminateTopic -> Just . TerminateChain $ Right chainId
  --     _ -> Nothing
  EventDBEntry ev -> (:) (PutEventDB ev) . maybeToList $
     case (eventDBChainId ev, eventDBName ev, eventDBArgs ev) of
      -- (Just chainId, "MemberAdded", [addressStr, enodeStr]) -> case stringAddress addressStr of
      --   Nothing -> Just . AddMember . Left $ "failed to parse address for MemberAdded event: " ++ addressStr
      --   Just address ->
          --TODO: we don't need this powerful of an evaluation, we just need to improve `readEnode`
          -- let eNode :: Either SomeException Enode = unsafePerformIO $ try . evaluate . force $ readEnode enodeStr
          --  in case eNode of
          --   Left err -> Just . AddMember . Left $ "failed to parse enode" ++ show err
          --   Right enode -> Just . AddMember $ Right (chainId, address, enode)
      -- (Just chainId, "MemberRemoved", [addressStr]) -> case stringAddress addressStr of
      --   Nothing -> Just . RemoveMember . Left $ "failed to parse address for MemberRemoved event: " ++ addressStr
      --   Just address -> Just . RemoveMember $ Right (chainId, address)
      (Just chainId, "OrganizationAdded", _) -> case eventDBArgs ev of
        (n:u:c:_)-> Just . AddOrgName $ Right (chainId, ChainMember (ChainMemberF (DFI.Identity $ T.pack n) (DFI.Identity (Just $ T.pack u)) (DFI.Identity (Just $ T.pack c))))
        (n:u:_)  -> Just . AddOrgName $ Right (chainId, ChainMember (ChainMemberF (DFI.Identity $ T.pack n) (DFI.Identity (Just $ T.pack u)) (DFI.Identity Nothing)))
        (n:_)    -> Just . AddOrgName $ Right (chainId, ChainMember (ChainMemberF (DFI.Identity $ T.pack n) (DFI.Identity Nothing) (DFI.Identity Nothing)))
        []       -> Just . AddOrgName . Left $ "failed to provide any arguments for OrganizationAdded event"
      (Just chainId, "OrganizationRemoved", _) -> case eventDBArgs ev of
        (n:u:c:_)-> Just . RemoveOrgName $ Right (chainId, ChainMember (ChainMemberF (DFI.Identity $ T.pack n) (DFI.Identity (Just $ T.pack u)) (DFI.Identity (Just $ T.pack c))))
        (n:u:_)  -> Just . RemoveOrgName $ Right (chainId, ChainMember (ChainMemberF (DFI.Identity $ T.pack n) (DFI.Identity (Just $ T.pack u)) (DFI.Identity Nothing)))
        (n:_)    -> Just . RemoveOrgName $ Right (chainId, ChainMember (ChainMemberF (DFI.Identity $ T.pack n) (DFI.Identity Nothing) (DFI.Identity Nothing)))
        []       -> Just . RemoveOrgName . Left $ "failed to provide any arguments for OrganizationRemoved event"
      (Nothing, "CertificateRegistered", [certString]) ->
        let cert = bsToCert . C8.pack $ certString
            userAddress = fmap (fromPublicKey . subPub) $ getCertSubject =<< eitherToMaybe cert
            org = maybe "" subOrg $ getCertSubject =<< eitherToMaybe cert
            orgUnit = fromMaybe Nothing $ Just . subUnit =<< getCertSubject =<< eitherToMaybe cert
            commonName = maybe "" subCommonName $ getCertSubject =<< eitherToMaybe cert
            -- commonName = fromMaybe Nothing $ Just . subCommonName =<< getCertSubject =<< eitherToMaybe cert
        in case (cert, userAddress) of
            (Left s, Nothing) -> Just . RegisterCertificate . Left $ "Failed to parse the certString for the CertificateRegistered event: " <> s
            (Left s, Just ua) -> Just . RegisterCertificate . Left $ "Failed to parse the certString for the CertificateRegistered event: " <> s <> "; " <> show ua
            (Right s, Nothing) -> Just . RegisterCertificate . Left $ "Failed to parse the certString's userAddress for the CertificateRegistered event: " <> show s
            (Right c, Just ua) -> Just . RegisterCertificate . Right $ (eventDBContractAddress ev, ua, X509CertInfoState{userAddress=ua, certificate=c, isValid=True, children=[],orgName=org, orgUnit=orgUnit, commonName=commonName})
      (Nothing, "CertificateRevoked", [userAddress]) ->
        let userAddress' = stringAddress userAddress
        in case userAddress' of
            Nothing -> Just . CertificateRevoked . Left $ "Failed to parse the certString for the CertificateRevoked event: " <> userAddress
            Just ua -> Just . CertificateRevoked . Right $ (eventDBContractAddress ev, ua)
      (Nothing, "CertificateRegistryInitialized", []) -> Just . CertificateRegistryInitialized . Right $ (eventDBContractAddress ev)
      _ -> Nothing
  TxResult r -> [PutTxResult r]
  _ -> []

txrResultHandler :: TxrResult -> IContextM ()
txrResultHandler = \case
  -- AddMember e -> case e of
  --   Right (chainId, address, enode) -> doAddMember chainId address enode
  --   Left err -> $logErrorS "txrIndexer" $ T.pack err
  -- RemoveMember e -> case e of
  --   Right (chainId, address) -> doRemoveMember chainId address
  --   Left err -> $logErrorS "txrIndexer" $ T.pack err
  AddOrgName e -> case e of
    Right (chainId, chainMember) -> doAddOrgName chainId chainMember
    Left err -> $logErrorS "txrIndexer" $ T.pack err
  RemoveOrgName e -> case e of
    Right (chainId, chainMember) -> doRemoveOrgName chainId chainMember
    Left err -> $logErrorS "txrIndexer" $ T.pack err
  RegisterCertificate e -> case e of
    Right (contractAddress, ua, certInfoState) -> doRegisterCertificate contractAddress ua certInfoState
    Left err -> $logErrorS "txrIndexer" $ T.pack err
  CertificateRevoked e -> case e of
    Right (contractAddress, userAddress) -> doRevokeCertificate contractAddress userAddress
    Left err -> $logErrorS "txrIndexer" $ T.pack err
  CertificateRegistryInitialized e -> case e of
    Right contractAddress -> doCertificateRegistryInitialized contractAddress
    Left err  -> $logErrorS "txrIndexer whaaat?" $ T.pack err
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
