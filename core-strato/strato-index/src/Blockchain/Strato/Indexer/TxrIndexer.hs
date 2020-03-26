{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell   #-}
module Blockchain.Strato.Indexer.TxrIndexer where

import           Conduit
import           Control.DeepSeq
import           Control.Exception
import           Control.Monad
import           Control.Monad.Trans.Class          (lift)
import           Control.Exception                  (SomeException)
import           Data.Binary
import qualified Data.ByteString                    as BS
import qualified Data.ByteString.Char8              as C8
import qualified Data.ByteString.Lazy               as BL
import qualified Data.List                          as List
import           Data.Maybe                         (maybeToList)
import qualified Data.Text                          as T
import           Data.Text.Encoding                 (decodeUtf8)
import           Network.Kafka
import           Blockchain.MilenaTools
import           Network.Kafka.Protocol

import           Blockchain.Data.ChainInfoDB        (addMember, removeMember, terminateChain)
import           Blockchain.Data.DataDefs           (LogDB (..), EventDB (..), TransactionResult (..))
import           Blockchain.Data.Enode
import qualified Blockchain.Data.LogDB              as LogDB
-- import qualified Blockchain.Data.EventDB            as EventDB
import           Blockchain.Data.TransactionDef     (formatChainId)
import qualified Blockchain.Data.TransactionResult  as TxrDB
import           Blockchain.EthConf                 (lookupConsumerGroup)
import           Blockchain.ExtWord

import           Blockchain.Output
import           Blockchain.Sequencer.Event
import           Blockchain.Sequencer.Kafka
import           Blockchain.SHA                     (hash)
import           Blockchain.Strato.Indexer.IContext
import           Blockchain.Strato.Indexer.Kafka
import           Blockchain.Strato.Indexer.Model
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.SHA
import qualified Blockchain.Strato.RedisBlockDB     as RBDB
import           Blockchain.Util                    (byteString2Integer)

import           System.IO.Unsafe                   (unsafePerformIO)
import           Text.Format

addTopic :: SHA
addTopic = hash $ C8.pack "MemberAdded(address,string)"

removeTopic :: SHA
removeTopic = hash $ C8.pack "MemberRemoved(address)"

terminateTopic :: SHA
terminateTopic = hash $ C8.pack "ChainTerminated()"

logF :: MonadLogger m => [String] -> m ()
logF = $logInfoS "txrIndexer" . T.pack . concat

doAddMember :: Word256 -> Address -> Enode -> IContextM ()
doAddMember chainId address enode = do
  logF [ "Adding member "
       , format address
       , " on chain "
       , formatChainId $ Just chainId
       ]
  lift $ addMember chainId address (showEnode enode) -- We only need the Text version for Postgres
  void . RBDB.withRedisBlockDB $ RBDB.addChainMember chainId address enode
  void . withKafkaRetry1s $ writeUnseqEvents [IENewChainMember chainId address enode]

doRemoveMember :: Word256 -> Address -> IContextM ()
doRemoveMember chainId address = do
  logF [ "Removing member "
       , format address
       , " on chain "
       , formatChainId $ Just chainId
       ]
  lift $ removeMember chainId address
  void . RBDB.withRedisBlockDB $ RBDB.removeChainMember chainId address

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

data TxrResult = AddMember (Either String (Word256, Address, Enode))
               | RemoveMember (Either String (Word256, Address))
               | TerminateChain (Either String Word256)
               | PutLogDB LogDB
               | PutEventDB EventDB
               | PutTxResult TransactionResult

indexEventToTxrResults :: IndexEvent -> [TxrResult]
indexEventToTxrResults = \case
  LogDBEntry l -> (:) (PutLogDB l) . maybeToList $ logDBChainId l >>= \chainId ->
    case logDBTopic1 l of
      Just x | SHA x == addTopic ->
        let address = decode . BL.fromStrict . BS.take 20 . BS.drop 12 $ logDBTheData l --TODO: unhack
            enodelen = fromInteger . byteString2Integer . BS.take 32 . BS.drop 64 $ logDBTheData l
            enode' = T.unpack . decodeUtf8 . BS.take enodelen . BS.drop 96 $ logDBTheData l
            --TODO: we don't need this powerful of an evaluation, we just need to improve `readEnode`
            eEnode :: Either SomeException Enode = unsafePerformIO $ try . evaluate . force $ readEnode enode'
         in case eEnode of
          Left err -> Just . AddMember . Left $ "failed to parse enode: " ++ show err
          Right enode -> Just . AddMember $ Right (chainId, address, enode)
      Just x | SHA x == removeTopic ->
        let address = decode . BL.fromStrict . BS.take 20 . BS.drop 12 $ logDBTheData l
         in Just . RemoveMember $ Right (chainId, address)
      Just x | SHA x == terminateTopic -> Just . TerminateChain $ Right chainId
      _ -> Nothing
  EventDBEntry ev -> (:) (PutEventDB ev) . maybeToList $ eventDBChainId ev >>= \chainId ->
     case (eventDBName ev, eventDBArgs ev) of
      ("MemberAdded", [addressStr, enodeStr]) -> case stringAddress addressStr of
        Nothing -> Just . AddMember . Left $ "failed to parse address for MemberAdded event: " ++ addressStr
        Just address ->
          --TODO: we don't need this powerful of an evaluation, we just need to improve `readEnode`
          let eNode :: Either SomeException Enode = unsafePerformIO $ try . evaluate . force $ readEnode enodeStr
           in case eNode of
            Left err -> Just . AddMember . Left $ "failed to parse enode" ++ show err
            Right enode -> Just . AddMember $ Right (chainId, address, enode)
      ("MemberRemoved", [addressStr]) -> case stringAddress addressStr of
        Nothing -> Just . RemoveMember . Left $ "failed to parse address for MemberRemoved event: " ++ addressStr
        Just address -> Just . RemoveMember $ Right (chainId, address)
      _ -> Nothing
  TxResult r -> [PutTxResult r]
  _ -> []

txrResultHandler :: TxrResult -> IContextM ()
txrResultHandler = \case
  AddMember e -> case e of
    Right (chainId, address, enode) -> doAddMember chainId address enode
    Left err -> $logErrorS "txrIndexer" $ T.pack err
  RemoveMember e -> case e of
    Right (chainId, address) -> doRemoveMember chainId address
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
  PutTxResult r -> do
    logF [ "Inserting TXResult for tx "
         , format $ transactionResultTransactionHash r
         , " at block "
         , format $ transactionResultBlockHash r
         ]
    void . lift $ TxrDB.putTransactionResult r

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
