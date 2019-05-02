{-# LANGUAGE FlexibleContexts     #-}
{-# LANGUAGE LambdaCase           #-}
{-# LANGUAGE OverloadedStrings    #-}
{-# LANGUAGE RankNTypes           #-}
{-# LANGUAGE TemplateHaskell      #-}

module Blockchain.CommunicationConduit
    ( handleMsgServerConduit
    , handleMsgClientConduit
    , mkEthP2PEventSource
    , mkEthP2PEventConduit
    ) where

import           Control.Monad.Change.Modify           (Accessible)
import           Control.Monad.IO.Unlift
import           Control.Monad.State
import           Control.Monad.Trans.Resource
import           Crypto.Types.PubKey.ECC
import qualified Data.ByteString                       as B
import qualified Data.ByteString.Char8                 as BC
import           Conduit
import qualified Data.Conduit.Binary                   as CB
import           Data.Conduit.Combinators              (yieldMany)
import qualified Data.Conduit.List                     as CL
import           Data.Conduit.Network
import           Data.Conduit.TQueue
import           Data.List.Split
import           Data.Maybe
import qualified Data.Text                             as T
import           Data.Void
import           UnliftIO.Concurrent                   hiding (yield)
import           UnliftIO.Exception
import           UnliftIO.STM

import           Network.Kafka                         as K

import           Blockchain.Constants                  hiding (ethVersion)
import           Blockchain.Context
import           Blockchain.Data.Block
import           Blockchain.Data.Control               (P2PCNC(..))
import           Blockchain.Data.DataDefs
import           Blockchain.Data.RLP
import           Blockchain.Data.Wire                  as W
import           Blockchain.DB.DetailsDB               hiding (getBestBlockHash)
import           Blockchain.DB.SQLDB
import           Blockchain.Display
import           Blockchain.Event
import           Blockchain.EventException
import           Blockchain.ExtMergeSources
import           Blockchain.Frame
import           Blockchain.Metrics
import           Blockchain.Options
import           Blockchain.Output
import           Blockchain.SeqEventNotify
import           Blockchain.Strato.Discovery.Data.Peer
import qualified Blockchain.Strato.RedisBlockDB        as RBDB
import           Blockchain.Strato.RedisBlockDB.Models
import           Blockchain.Stream.VMEvent
import           Blockchain.TimerSource
import           Blockchain.Util
import           Blockchain.Watchdog

ethVersion :: Int
ethVersion = 62
{-# INLINE ethVersion #-}

blockstanbulVersion :: Int
blockstanbulVersion = 1

mkEthP2PEventSource :: ( MonadResource m
                       , MonadLogger m
                       , MonadUnliftIO m
                       )
                    => AppData
                    -> EthCryptState
                    -> K.KafkaState
                    -> m (ConduitM () Event m ())
mkEthP2PEventSource app inCtx ks = do
  canarySource <- mkCanarySource
  tid <- myThreadId
  recvWatchdog <- mkWatchdog tid $ fromIntegral flags_connectionTimeout
  merged <- mergeSourcesByForce (
    [ appSource app
        .| ethDecrypt inCtx
        .| bytesToMessages
        .| CL.iterM (displayMessage Inbound (show $ appSockAddr app))
        .| CL.map MsgEvt
        .| CL.iterM (const $ petWatchdog recvWatchdog)
    , seqEventNotificationSource ks
        .| CL.map NewSeqEvent
    , canarySource .| CL.map absurd
    , timerSource
    ]) 4096 -- 🙏
  return $ merged
        .| CL.iterM recordEvent

mkCanarySource :: (MonadLogger m, MonadUnliftIO m, MonadResource m) => m (ConduitM () Void m ())
mkCanarySource = do
  ender <- toIO $ $logInfoS "canary/exit" "" >> killCanary
  void . register $ ender
  q <- atomically newTQueue
  $logInfoS "canary/enter" ""
  addCanary
  -- Wait forever on nothing
  return $ sourceTQueue q

mkEthP2PEventConduit :: (MonadResource m, MonadLogger m, MonadUnliftIO m)
                     => String
                     -> EthCryptState
                     -> m (ConduitM (Either P2PCNC Message) BC.ByteString m ())
mkEthP2PEventConduit str outCtx = do
  tid <- myThreadId
  sendWatchdog <- mkWatchdog tid $ fromIntegral flags_connectionTimeout
  return $ debounceTxSends
        .| CL.iterM recordMessage
        .| CL.iterM (displayMessage Outbound str)
        .| CL.iterM (const $ petWatchdog sendWatchdog)
        .| messageToBytes
        .| ethEncrypt outCtx

debounceTxSends :: MonadIO m => ConduitT (Either P2PCNC Message) Message m ()
debounceTxSends = do
  txq <- atomically newTQueue
  awaitForever $ \case
    Right (W.Transactions txs) -> do
      atomically $ mapM_ (writeTQueue txq) txs
      recordQueuedTxs txs
    Right other -> yield other
    Left TXQueueTimeout -> do
      txs <- atomically $ flushTQueue txq
      recordEmptyQueue
      yieldMany . map W.Transactions $ chunksOf 100 txs

handleMsgClientConduit :: ( MonadIO (StateT Context m)
                          , MonadResource m
                          , Accessible RBDB.RedisConnection (StateT Context m)
                          , WrapsSQLDB (StateT Context) m
                          , MonadLogger (StateT Context m)
                          )
                       => Point
                       -> PPeer
                       -> ConduitM Event (Either P2PCNC Message) (StateT Context m) ()
handleMsgClientConduit myId peer = do
    $logDebugS "handleMsgClientConduit" $ T.pack $ "<waving hand emoji>"
    yield $ Right Hello { version = 4
                      , clientId = stratoVersionString
                      , capability = [ ETH . fromIntegral $ ethVersion
                                     , IST . fromIntegral $ blockstanbulVersion
                                     ]
                      , port = 0
                      , nodeId = myId
                      }
    $logDebugS "handleMsgClientConduit" $ T.pack $ "about to parse message"
    awaitMsg >>= \case
        Just Hello{} ->
            RBDB.withRedisBlockDB RBDB.getBestBlockInfo >>= \case
                Nothing -> error "we don't have a local BestBlock"
                Just (RedisBestBlock hash _ tdiff) -> do
                    genHash <- lift . runWithSQL $ getGenesisBlockHash
                    yield $ Right Status {
                        protocolVersion = fromIntegral ethVersion,
                        networkID       = computeNetworkID,
                        totalDifficulty = fromIntegral tdiff,
                        latestHash      = hash,
                        genesisHash     = genHash
                    }
        other -> assertHandshake other
    awaitMsg >>= \case
        Just Status{totalDifficulty=peerTD, genesisHash=peerGH, latestHash=peerBestHash} -> do
                genHash <- lift . runWithSQL $ getGenesisBlockHash
                when (peerGH /= genHash) $ throwIO WrongGenesisBlock
                void $ RBDB.withRedisBlockDB (RBDB.updateWorldBestBlockInfo peerBestHash 0 peerTD) -- we set to 0 cause we dont necessarily know the number yet
                lastBlockNumber <- liftIO getBestKafkaBlockNumber
                Just (ChainBlock firstBlock:_) <- liftIO $ fetchVMEventsIO 0
                mrh <- gets maxReturnedHeaders
                yield . Right $ GetBlockHeaders (BlockNumber (max (lastBlockNumber - flags_syncBacktrackNumber) (blockDataNumber $ blockBlockData firstBlock))) mrh 0 Forward
                yield . Right $ GetChainDetails []
                handleGetChainDetails peer []
                stampActionTimestamp
        other -> assertHandshake other
    handleEvents peer

handleMsgServerConduit :: (MonadIO (StateT Context m)
                         , MonadResource m
                         , Accessible RBDB.RedisConnection (StateT Context m)
                         , WrapsSQLDB (StateT Context) m
                         , MonadLogger (StateT Context m)
                         )
                 => Point
                 -> PPeer
                 -> ConduitM Event (Either P2PCNC Message) (StateT Context m) ()
handleMsgServerConduit myPubkey peer = do
    $logDebugS "handleMsgServerConduit" $ T.pack $ "about to parse message"
    awaitMsg >>= \case
        Just Hello{} -> do
            $logInfoS "handshake/Hello{}" "received hello"
            let helloMsg' = Hello {
                version = 4,
                clientId = stratoVersionString,
                capability = [ETH (fromIntegral  ethVersion ) ],
                port = 0,
                nodeId = myPubkey
            }
            yield $ Right helloMsg'
        other -> assertHandshake $ other
    awaitMsg >>= \case
        Just Status{totalDifficulty=peerTD, genesisHash=peerGH, latestHash=peerBestHash} -> do
            $logInfoS "serverHandshake/Status{}" "received status"
            RBDB.withRedisBlockDB RBDB.getBestBlockInfo >>= \case
                Nothing -> error "we don't have a local BestBlock!"
                Just (RedisBestBlock hash _ tdiff) -> do
                    genHash <- lift . runWithSQL $ getGenesisBlockHash
                    when (genHash /= peerGH) $ error "peer has a different genesis block than we do!"
                    void $ RBDB.withRedisBlockDB (RBDB.updateWorldBestBlockInfo peerBestHash 0 peerTD) -- we set to 0 cause we dont necessarily know the number yet
                    yield $ Right Status {
                        protocolVersion=fromIntegral ethVersion,
                        networkID=computeNetworkID,
                        totalDifficulty= fromIntegral tdiff,
                        latestHash=hash,
                        genesisHash=genHash
                    }
        other -> assertHandshake other
    handleEvents peer

awaitMsg :: (MonadIO m) => ConduitM Event (Either P2PCNC Message) m (Maybe Message)
awaitMsg = await >>= \case
    Just (MsgEvt msg) -> return (Just msg)
    Nothing           -> return Nothing
    _                 -> awaitMsg

assertHandshake :: (MonadLogger m, MonadIO m)
                => Maybe Message
                -> m ()
assertHandshake mmsg = do
    let theFail = maybe PeerDisconnected EventBeforeHandshake mmsg
    $logErrorS "assertHandshake" . T.pack $ "assertHandshake called: " ++ show theFail
    throwIO theFail

cbSafeTake' :: forall o m. Monad m
            => Int
            -> ConduitM BC.ByteString o m BC.ByteString
cbSafeTake' i = fromMaybe (error "cb\"Safe\"Take: not enough data") <$> cbSafeTake i

getRLPData :: Monad m => forall void . ConduitM B.ByteString void m B.ByteString
getRLPData = (fromMaybe $ error "no rlp data") <$> CB.head >>= \case
   x | x < 128                 -> return $ B.singleton x
   x | x >= 192 && x <= 192+55 -> do
         rest <- cbSafeTake' $ fromIntegral $ x - 192
         return $ x `B.cons` rest
   x | x >= 0xF8 && x <= 0xFF   -> do
         length' <- cbSafeTake' $ fromIntegral x - 0xF7
         rest <- cbSafeTake' . fromIntegral . bytes2Integer $ B.unpack length'
         return $ x `B.cons` length' `B.append` rest
   x                             -> error $ "missing case in getRLPData: " ++ show x


bytesToMessages :: Monad m => ConduitM B.ByteString Message m ()
bytesToMessages = forever $ do
    msgTypeData <- cbSafeTake' 1
    let word = fromInteger (rlpDecode $ rlpDeserialize msgTypeData :: Integer)
    objBytes <- getRLPData
    yield $ obj2WireMessage word $ rlpDeserialize objBytes

messageToBytes :: Monad m => ConduitM Message B.ByteString m ()
messageToBytes = mapC $ \msg ->
  let (theWord, o) = wireMessage2Obj msg
  in theWord `B.cons` rlpSerialize o
