{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE LambdaCase        #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell   #-}
module Blockchain.Strato.Indexer.TxrIndexer where

import           Control.Monad
import           Control.Monad.Logger
import           Control.Monad.IO.Class             (liftIO)
import           Control.Monad.Trans.Class          (lift)
import           Control.Exception                  (catch, SomeException)
import           Data.Binary
import qualified Data.ByteString                    as BS
import qualified Data.ByteString.Char8              as C8
import qualified Data.ByteString.Lazy               as BL
import qualified Data.Map.Strict                    as Map
import           Data.Maybe                         (isJust)
import qualified Data.Text                          as T
import           Data.Text.Encoding                 (decodeUtf8)
import           Network.Kafka
import           Blockchain.MilenaTools
import           Network.Kafka.Protocol

import           Blockchain.Data.ChainInfoDB        (addMember, removeMember, terminateChain)
import           Blockchain.Data.DataDefs           (LogDB (..), TransactionResult (..))
import           Blockchain.Data.Enode
import qualified Blockchain.Data.LogDB              as LogDB
import qualified Blockchain.Data.TransactionResult  as TxrDB
import           Blockchain.EthConf                 (lookupConsumerGroup)
import           Blockchain.Format

import           Blockchain.SHA                     (hash)
import           Blockchain.Strato.Indexer.IContext
import           Blockchain.Strato.Indexer.Kafka
import           Blockchain.Strato.Indexer.Model
import           Blockchain.Strato.Model.SHA
import qualified Blockchain.Strato.RedisBlockDB     as RBDB
import           Blockchain.Util                    (byteString2Integer)

import           Numeric

addTopic :: SHA
addTopic = hash $ C8.pack "MemberAdded(address,string)"

removeTopic :: SHA
removeTopic = hash $ C8.pack "MemberRemoved(address)"

terminateTopic :: SHA
terminateTopic = hash $ C8.pack "ChainTerminated()"

txrIndexer :: LoggingT IO ()
txrIndexer = runIContextM "strato-txr-indexer" . forever $ do
    $logInfoS "txrIndexer" "About to fetch IndexEvents"
    (offset, idxEvents) <- getUnprocessedIndexEvents
    $logInfoS "txrIndexer" . T.pack $ "Fetched " ++ show (length idxEvents) ++ " events starting from " ++ show offset
    let zipIdxEvents = zip [offset+1..] idxEvents
    forM_ zipIdxEvents $ \(nextIdx, e) -> do -- todo: don't insert one-by-one?
        case e of
            LogDBEntry l -> do
                let mChainId = logDBChainId l
                    topic1 = logDBTopic1 l
                $logInfoS "txrIndexer" . T.pack $ "Inserting LogDB entry for tx: " ++ format (logDBTransactionHash l) ++ " on chain " ++ show (flip showHex "" <$> mChainId) ++ " at block " ++ format (logDBBlockHash l)
                when (isJust mChainId) $ do
                  let Just chainId = mChainId
                  case topic1 of
                    Just x | SHA x == addTopic -> do
                      let address = decode . BL.fromStrict . BS.take 20 . BS.drop 12 $ logDBTheData l --TODO: unhack
                          enodelen = fromInteger . byteString2Integer . BS.take 32 . BS.drop 64 $ logDBTheData l
                          enode' = T.unpack . decodeUtf8 . BS.take enodelen . BS.drop 96 $ logDBTheData l
                      mEnode <- liftIO $ (return . Just $ readEnode enode') `catch` (\(_ :: SomeException) -> return Nothing)
                      when (isJust mEnode) $ do
                        let Just enode = mEnode
                        $logInfoS "txrIndexer" . T.pack $ "Adding member " ++ (showHex address "") ++ " on chain " ++ showHex chainId ""
                        lift $ addMember chainId address enode' -- We only need the Text version for Postgres
                        mems <- RBDB.withRedisBlockDB $ RBDB.getChainMembers chainId
                        void . RBDB.withRedisBlockDB $
                          RBDB.putChainMembers chainId $ Map.insert address enode mems
                    Just x | SHA x == removeTopic -> do
                      let address = decode . BL.fromStrict . BS.take 20 . BS.drop 12 $ logDBTheData l
                      $logInfoS "txrIndexer" . T.pack $ "Removing member " ++ (showHex address "") ++ " on chain " ++ showHex chainId ""
                      lift $ removeMember chainId address
                      mems <- RBDB.withRedisBlockDB $ RBDB.getChainMembers chainId
                      void . RBDB.withRedisBlockDB $
                        RBDB.putChainMembers chainId $ Map.delete address mems
                    Just x | SHA x == terminateTopic -> do
                      $logInfoS "txrIndexer" . T.pack $ "Terminating chain " ++ showHex chainId ""
                      lift $ terminateChain chainId
                    _ -> return ()
                void . lift $ LogDB.putLogDB l
            TxResult r -> do
                $logInfoS "txrIndexer" . T.pack $
                    "Inserting TXResult for tx " ++ format (transactionResultTransactionHash r) ++ " at block " ++ format (transactionResultBlockHash r)
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
