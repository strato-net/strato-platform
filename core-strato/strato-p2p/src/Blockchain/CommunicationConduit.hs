{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE LambdaCase        #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RankNTypes        #-}
{-# LANGUAGE TemplateHaskell   #-}

module Blockchain.CommunicationConduit
    ( handleMsgServerConduit
    , handleMsgClientConduit
    , mkEthP2PEventSource
    , mkEthP2PEventConduit
    ) where

import           Control.Exception.Lifted              (throwIO)
import           Control.Monad
import           Control.Monad.Base                    (MonadBase)
import           Control.Monad.IO.Unlift
import           Control.Monad.Logger
import           Control.Monad.Trans.Class
import           Control.Monad.Trans.Resource
import           Crypto.Types.PubKey.ECC
import qualified Data.ByteString                       as B
import qualified Data.ByteString.Char8                 as BC
import           Data.Conduit
import qualified Data.Conduit.Binary                   as CB
import qualified Data.Conduit.List                     as CL
import           Data.Conduit.Network
import           Data.Maybe
import qualified Data.Text                             as T

import           Blockchain.Constants                  hiding (ethVersion)
import           Blockchain.Context
import           Blockchain.Data.Block
import           Blockchain.Data.DataDefs
import           Blockchain.Data.RLP
import           Blockchain.Data.Wire
import           Blockchain.DB.DetailsDB               hiding (getBestBlockHash)
import           Blockchain.DBM
import           Blockchain.Display
import           Blockchain.Event
import           Blockchain.EventException
import           Blockchain.ExtMergeSources
import           Blockchain.Frame
import           Blockchain.Metrics
import           Blockchain.Options
import           Blockchain.SeqEventNotify
import           Blockchain.ServOptions
import           Blockchain.Strato.Discovery.Data.Peer
import qualified Blockchain.Strato.RedisBlockDB        as RBDB
import           Blockchain.Strato.RedisBlockDB.Models
import           Blockchain.Stream.VMEvent
import           Blockchain.Util

ethVersion :: Int
ethVersion = 62
{-# INLINE ethVersion #-}

blockstanbulVersion :: Int
blockstanbulVersion = 1

mkEthP2PEventSource :: ( HasContextControl m
                       , MonadLogger m
                       )
                    => AppData
                    -> EthCryptState
                    -> [Source m Event]
                    -> m (Source m Event)
mkEthP2PEventSource app inCtx extra = (.| CL.iterM recordEvent) <$> mergeSourcesCloseForAny (
    [ appSource app
        .| ethDecrypt inCtx
        .| bytesToMessages
        .| CL.iterM (displayMessage Inbound (show $ appSockAddr app))
        .| CL.map MsgEvt
    , seqEventNotificationSource
        .| CL.map NewSeqEvent
    ] ++ extra) (2 + length extra)

mkEthP2PEventConduit :: (Monad m, MonadResource m, MonadLogger m)
                     => String
                     -> EthCryptState
                     -> Conduit Message m BC.ByteString
mkEthP2PEventConduit str outCtx =
     CL.iterM recordMessage
  .| CL.iterM (displayMessage Outbound str)
  .| messageToBytes
  .| ethEncrypt outCtx

handleMsgClientConduit :: (HasContextControl m, MonadLogger m, MonadThrow m)
                       => Point
                       -> PPeer
                       -> Conduit Event m Message
handleMsgClientConduit myId peer = do
    $logDebugS "handleMsgClientConduit" "<waving hand emoji>"
    yield Hello { version = 4
                      , clientId = stratoVersionString
                      , capability = [ ETH . fromIntegral $ ethVersion
                                     , IST . fromIntegral $ blockstanbulVersion
                                     ]
                      , port = 0
                      , nodeId = myId
                      }
    $logDebugS "handleMsgClientConduit" "about to parse message"
    awaitMsg >>= \case
        Just Hello{} ->
            lift (RBDB.withRedisBlockDB RBDB.getBestBlockInfo) >>= \case
                Nothing -> error "we don't have a local BestBlock"
                Just (RedisBestBlock hash _ tdiff) -> do
                    genHash <- lift getGenesisBlockHash
                    yield Status {
                        protocolVersion = fromIntegral ethVersion,
                        networkID       = ourNetworkID,
                        totalDifficulty = fromIntegral tdiff,
                        latestHash      = hash,
                        genesisHash     = genHash
                    }
        other -> assertHandshake other
    awaitMsg >>= \case
        Just Status{totalDifficulty=peerTD, genesisHash=peerGH, latestHash=peerBestHash} -> do
                genHash <- lift getGenesisBlockHash
                when (peerGH /= genHash) $ throwIO WrongGenesisBlock
                -- we set to 0 cause we dont necessarily know the number yet
                void . lift $ RBDB.withRedisBlockDB (RBDB.updateWorldBestBlockInfo peerBestHash 0 peerTD)
                lastBlockNumber <- liftIO getBestKafkaBlockNumber
                Just (ChainBlock firstBlock:_) <- liftIO $ fetchVMEventsIO 0
                count <- getMaxHeaders
                let start = max (lastBlockNumber - flags_syncBacktrackNumber)
                                (blockDataNumber $ blockBlockData firstBlock)
                yield $ GetBlockHeaders (BlockNumber start) count 0 Forward
                stampActionTimestamp
        other -> assertHandshake other
    handleEvents (if flags_debugFail then Fail else Log) peer

      where ourNetworkID = if flags_cNetworkID == -1 then (if flags_cTestnet then 0 else 1) else flags_cNetworkID

handleMsgServerConduit :: (HasContextControl m, MonadLogger m, MonadThrow m)
                 => Point
                 -> PPeer
                 -> Conduit Event m Message
handleMsgServerConduit myPubkey peer = do
    $logDebugS "handleMsgServerConduit" "about to parse message"
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
            yield helloMsg'
        other -> assertHandshake other
    awaitMsg >>= \case
        Just Status{totalDifficulty=peerTD, genesisHash=peerGH, latestHash=peerBestHash} -> do
            $logInfoS "serverHandshake/Status{}" "received status"
            RBDB.withRedisBlockDB RBDB.getBestBlockInfo >>= \case
                Nothing -> error "we don't have a local BestBlock!"
                Just (RedisBestBlock hash _ tdiff) -> do
                    genHash <- lift getGenesisBlockHash
                    when (genHash /= peerGH) $ error "peer has a different genesis block than we do!"
                    -- we set to 0 cause we dont necessarily know the number yet
                    void $ RBDB.withRedisBlockDB (RBDB.updateWorldBestBlockInfo peerBestHash 0 peerTD)
                    yield Status {
                        protocolVersion=fromIntegral ethVersion,
                        networkID=flags_networkID,
                        totalDifficulty= fromIntegral tdiff,
                        latestHash=hash,
                        genesisHash=genHash
                    }
        other -> assertHandshake other
    handleEvents (if flags_debugFail then Fail else Log) peer

awaitMsg :: (MonadIO m) => ConduitM Event Message m (Maybe Message)
awaitMsg = await >>= \case
    Just (MsgEvt msg) -> return (Just msg)
    Nothing              -> return Nothing
    _                    -> awaitMsg

assertHandshake :: (MonadLogger m, MonadIO m, MonadBase IO m)
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

getRLPData :: Monad m => Consumer B.ByteString m B.ByteString
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


bytesToMessages :: Monad m => Conduit B.ByteString m Message
bytesToMessages = forever $ do
    msgTypeData <- cbSafeTake' 1
    let word = fromInteger (rlpDecode $ rlpDeserialize msgTypeData :: Integer)
    objBytes <- getRLPData
    yield $ obj2WireMessage word $ rlpDeserialize objBytes

messageToBytes :: Monad m => Conduit Message m B.ByteString
messageToBytes = do
    maybeMsg <- await
    case maybeMsg of
     Nothing -> return ()
     Just msg -> do
        let (theWord, o) = wireMessage2Obj msg
        yield $ theWord `B.cons` rlpSerialize o
        messageToBytes
