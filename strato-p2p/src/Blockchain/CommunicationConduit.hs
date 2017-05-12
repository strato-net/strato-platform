{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE LambdaCase        #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RankNTypes        #-}
{-# LANGUAGE TemplateHaskell   #-}

module Blockchain.CommunicationConduit
    ( handleMsgServerConduit
    , handleMsgClientConduit
    , awaitMsg
    , mkEthP2PEventConduit
    , mkEthP2PEventSource
    ) where

import           Blockchain.Constants                  hiding (ethVersion)
import           Blockchain.Context
import           Blockchain.Data.DataDefs
import           Blockchain.Data.Wire
import           Blockchain.DB.DetailsDB               hiding (getBestBlockHash)
import           Blockchain.DB.SQLDB
import           Blockchain.DBM
import           Blockchain.Display
import           Blockchain.Event
import           Blockchain.EventException
import           Blockchain.ExtMergeSources
import           Blockchain.Frame
import           Blockchain.Options
import           Blockchain.SeqEventNotify
import           Blockchain.ServOptions
import           Blockchain.Strato.Discovery.Data.Peer
import qualified Blockchain.Strato.RedisBlockDB        as RBDB
import           Blockchain.Strato.RedisBlockDB.Models
import           Blockchain.Stream.VMEvent
import           Blockchain.TimerSource

import           Control.Exception.Lifted              (throwIO)
import           Control.Monad.Logger
import           Control.Monad.State
import           Control.Monad.Trans.Resource
import           Crypto.Types.PubKey.ECC
import qualified Data.ByteString                       as B
import qualified Data.ByteString.Char8                 as BC
import qualified Data.ByteString.Lazy                  as BL
import           Data.Conduit
import qualified Data.Conduit.Binary                   as CB
import qualified Data.Conduit.List                     as CL
import           Data.Conduit.Network
import qualified Data.Text                             as T

import           Network.Kafka

import           Blockchain.Data.RLP
import           Blockchain.RLPx
import           Blockchain.Util
import           Data.Maybe

ethVersion :: Int
ethVersion = 62
{-# INLINE ethVersion #-}

mkEthP2PEventSource :: ( Monad m
                       , MonadResource m
                       , MonadBaseControl IO m
                       , MonadLogger m
                       , HasKafkaState m
                       )
                    => AppData
                    -> EthCryptState
                    -> m (Source m Event)
mkEthP2PEventSource app inCtx = mergeSourcesCloseForAny [ appSource app
                                                            =$= ethDecrypt inCtx
                                                            =$= bytesToMessages
                                                            =$= tap (displayMessage False (show $ appSockAddr app))
                                                            =$= CL.map MsgEvt
                                                        , seqEventNotifictationSource =$= CL.map NewSeqEvent
                                                        , timerSource
                                                        ] 3

mkEthP2PEventConduit :: (Monad m, MonadResource m, MonadLogger m)
                     => AppData
                     -> EthCryptState
                     -> Conduit Message m BC.ByteString
mkEthP2PEventConduit app outCtx = tap (displayMessage True (show $ appSockAddr app))
                                   =$= messagesToBytes
                                   =$= ethEncrypt outCtx

awaitMsg :: (Monad m, MonadIO m) => ConduitM Event Message m (Maybe Message)
awaitMsg = await >>= \case
    Just (MsgEvt msg) -> return $ Just msg
    Nothing           -> return Nothing
    _                 -> awaitMsg


handleMsgClientConduit :: (MonadIO m, RBDB.HasRedisBlockDB m, MonadState Context m, HasSQLDB m, MonadLogger m)
                       => Point
                       -> PPeer
                       -> Conduit Event m Message
handleMsgClientConduit myId peer = do
    yield Hello { version = 4
                , clientId = stratoVersionString
                , capability = [ETH . fromIntegral $ ethVersion]
                , port = 0
                , nodeId = myId
                }
    awaitMsg >>= \case
        Just Hello{} ->
            RBDB.withRedisBlockDB RBDB.getBestBlockInfo >>= \case
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
                genHash <- fromMaybe (error "we disgust ourselves and are miserable excuses for human beings") <$> lift (RBDB.withRedisBlockDB RBDB.getGenesisHash)
                when (peerGH /= genHash) $ throwIO WrongGenesisBlock
                void $ RBDB.withRedisBlockDB (RBDB.updateWorldBestBlockInfo peerBestHash 0 peerTD) -- we set to 0 cause we dont necessarily know the number yet
                lastBlockNumber <- liftIO getBestKafkaBlockNumber
                Just (ChainBlock firstBlock:_) <- liftIO $ fetchVMEventsIO 0
                yield $ GetBlockHeaders (BlockNumber (max (lastBlockNumber - flags_syncBacktrackNumber) (blockDataNumber $ blockBlockData firstBlock))) maxReturnedHeaders 0 Forward
                stampActionTimestamp
        other -> assertHandshake other

    handleEvents (if flags_debugFail then Fail else Log) peer

      where assertHandshake m = do
                $logInfoS "handleMsg/assertHandshake" $ T.pack $ "asserHandshake: " ++ show m
                throwIO . maybe PeerDisconnected EventBeforeHandshake $ m
            ourNetworkID    = if flags_cNetworkID == -1 then (if flags_cTestnet then 0 else 1) else flags_cNetworkID

handleMsgServerConduit :: (MonadIO m, MonadResource m, RBDB.HasRedisBlockDB m, HasSQLDB m, MonadState Context m, MonadLogger m)
                 => Point
                 -> PPeer
                 -> Conduit Event m Message
handleMsgServerConduit myPubkey peer = do
    awaitMsg >>= \case
        Just Hello{} -> do
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
        Just Status{totalDifficulty=peerTD, genesisHash=peerGH, latestHash=peerBestHash} ->
            RBDB.withRedisBlockDB RBDB.getBestBlockInfo >>= \case
                Nothing -> error "we don't have a local BestBlock!"
                Just (RedisBestBlock hash _ tdiff) -> do
                    genHash <- lift getGenesisBlockHash
                    when (genHash /= peerGH) $ error "peer has a different genesis block than we do!"
                    void $ RBDB.withRedisBlockDB (RBDB.updateWorldBestBlockInfo peerBestHash 0 peerTD) -- we set to 0 cause we dont necessarily know the number yet
                    yield Status {
                        protocolVersion=fromIntegral ethVersion,
                        networkID=flags_networkID,
                        totalDifficulty= fromIntegral tdiff,
                        latestHash=hash,
                        genesisHash=genHash
                    }
        other -> assertHandshake other
    handleEvents (if flags_debugFail then Fail else Log) peer

    where assertHandshake = error . maybe "peer communicated before handshake was complete"
                                          (const "peer hung up before handshake finished")
cbSafeTake :: Monad m
           => Int
           -> ConduitM BC.ByteString o m BC.ByteString
cbSafeTake i = do
  ret <- BL.toStrict <$> CB.take i
  if B.length ret /= i
    then error "safeTake: not enough data"
    else return ret

getRLPData :: Monad m => Consumer B.ByteString m B.ByteString
getRLPData = (fromMaybe $ error "no rlp data") <$> CB.head >>= \case
   x | x < 128                 -> return $ B.singleton x
   x | x >= 192 && x <= 192+55 -> do
         rest <- cbSafeTake $ fromIntegral $ x - 192
         return $ x `B.cons` rest
   x | x >= 0xF8 && x <= 0xFF   -> do
         length' <- cbSafeTake $ fromIntegral x - 0xF7
         rest <- cbSafeTake . fromIntegral . bytes2Integer $ B.unpack length'
         return $ x `B.cons` length' `B.append` rest
   x                             -> error $ "missing case in getRLPData: " ++ show x


bytesToMessages :: MonadIO m => Conduit B.ByteString m Message
bytesToMessages = forever $ do
    msgTypeData <- cbSafeTake 1
    let word = fromInteger (rlpDecode $ rlpDeserialize msgTypeData::Integer)
    objBytes <- getRLPData
    yield $ obj2WireMessage word $ rlpDeserialize objBytes

messagesToBytes :: Monad m => Conduit Message m B.ByteString
messagesToBytes = do
    maybeMsg <- await
    case maybeMsg of
     Nothing -> return ()
     Just msg -> do
        let (theWord, o) = wireMessage2Obj msg
        yield $ theWord `B.cons` rlpSerialize o
