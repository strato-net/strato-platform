{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell   #-}
module Blockchain.Strato.Indexer.TxrIndexer where

import           Control.DeepSeq
import           Control.Exception
import           Control.Monad
import           Control.Monad.IO.Class             (liftIO)
import           Control.Monad.Trans.Class          (lift)
import           Control.Exception                  (SomeException)
import           Data.Binary
import qualified Data.ByteString                    as BS
import qualified Data.ByteString.Char8              as C8
import qualified Data.ByteString.Lazy               as BL
import           Data.Foldable                      (for_)
import qualified Data.List                          as List
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
    $logInfoS "txrIndexer" . T.pack $ "Fetched " ++ show (length idxEvents) ++ " events starting from " ++ show offset
    let zipIdxEvents = zip [offset+1..] idxEvents
    forM_ zipIdxEvents $ \(nextIdx, e) -> do -- todo: don't insert one-by-one?
        case e of
            LogDBEntry l -> for_ (logDBChainId l) $ \chainId -> do
                logF [ "Inserting LogDB entry for tx: "
                     , format $ logDBTransactionHash l
                     , " on chain "
                     , formatChainId $ Just chainId
                     , " at block "
                     , format $ logDBBlockHash l
                     ]
                case logDBTopic1 l of
                  Just x | SHA x == addTopic -> do
                    let address = decode . BL.fromStrict . BS.take 20 . BS.drop 12 $ logDBTheData l --TODO: unhack
                        enodelen = fromInteger . byteString2Integer . BS.take 32 . BS.drop 64 $ logDBTheData l
                        enode' = T.unpack . decodeUtf8 . BS.take enodelen . BS.drop 96 $ logDBTheData l
                    eEnode :: Either SomeException Enode <- liftIO . try . evaluate . force $ readEnode enode' --TODO: we don't need this powerful of an evaluation, we just need to improve `readEnode`
                    case eEnode of
                      Left err -> $logErrorS "txrIndexer" . T.pack $ "failed to parse enode: " ++ show err
                      Right enode -> doAddMember chainId address enode
                  Just x | SHA x == removeTopic -> do
                    let address = decode . BL.fromStrict . BS.take 20 . BS.drop 12 $ logDBTheData l
                    doRemoveMember chainId address
                  Just x | SHA x == terminateTopic -> do
                    logF ["Terminating chain ", formatChainId $ Just chainId]
                    lift $ terminateChain chainId
                  _ -> return ()
                void . lift $ LogDB.putLogDB l
            EventDBEntry ev -> for_ (eventDBChainId ev) $ \chainId -> do
                let evName = eventDBName ev
                    evArgs = eventDBArgs ev
                logF [ "Inserting EventDB entry for Event: "
                     , evName
                     , " with args: "
                     , List.intercalate "," evArgs
                     , " for chainID: "
                     , formatChainId $ Just chainId
                     ]
                case (evName, evArgs) of
                  ("MemberAdded", [addressStr, enodeStr]) -> case stringAddress addressStr of
                    Nothing -> $logErrorS "txrIndexer" . T.pack $ "failed to parse address for MemberAdded event: " ++ addressStr
                    Just address -> do
                      eNode :: Either SomeException Enode <- liftIO . try . evaluate . force $ readEnode enodeStr --TODO: we don't need this powerful of an evaluation, we just need to improve `readEnode`
                      case eNode of
                        Left err -> $logErrorS "txrIndexer" . T.pack $ "failed to parse enode" ++ show err
                        Right enode -> doAddMember chainId address enode
                  ("MemberRemoved", [addressStr]) -> case stringAddress addressStr of
                    Nothing -> $logErrorS "txrIndexer" . T.pack $ "failed to parse address for MemberRemoved event: " ++ addressStr
                    Just address -> doRemoveMember chainId address
                  _ -> return ()
                -- void . lift $ EventDB.putEventDB ev
                -- ^^^ NOTE: not actually putting events into eth database, but still need
                --       them so we can check process governance changes
            TxResult r -> do

                logF [ "Inserting TXResult for tx "
                     , format $ transactionResultTransactionHash r
                     , " at block "
                     , format $ transactionResultBlockHash r
                     ]
                void . lift $ TxrDB.putTransactionResult r
            _ -> return ()
        setKafkaCheckpoint nextIdx

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
    withKafkaViolently (commitSingleOffset (snd kafkaClientIds) targetTopicName 0 ofs "") >>= \case
        Left err -> error $ "Unexpected response when setting checkpoint to " ++ show ofs ++ ": " ++ show err
        Right () -> return ()

getUnprocessedIndexEvents :: IContextM (Offset, [IndexEvent])
getUnprocessedIndexEvents = do
    ofs <- getKafkaCheckpoint
    evs <- withKafkaRetry1s (readIndexEvents ofs)
    return (ofs, evs)
