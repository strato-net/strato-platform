{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE RankNTypes #-}

module Blockchain.CommunicationConduit
    ( handleMsgConduit
    ) where

import Conduit
import Control.Monad.Logger
import Control.Monad.State
import Crypto.Types.PubKey.ECC

import Blockchain.Constants hiding (ethVersion)
import Blockchain.Context
import Blockchain.Strato.Discovery.Data.Peer
import Blockchain.Data.Wire
import Blockchain.DB.DetailsDB hiding (getBestBlockHash)
import Blockchain.DB.SQLDB
import Blockchain.DBM
import Blockchain.Event
import Blockchain.ServOptions
import Blockchain.Options

import           Blockchain.Strato.RedisBlockDB.Models
import qualified Blockchain.Strato.RedisBlockDB as RBDB

ethVersion :: Int
ethVersion = 62
{-# INLINE ethVersion #-}

awaitMsg :: MonadIO m => ConduitM Event Message m (Maybe Message)
awaitMsg = await >>= \case
    Just (MsgEvt msg) -> return $ Just msg
    Nothing           -> return Nothing
    _                 -> awaitMsg
      
handleMsgConduit :: (MonadIO m, MonadResource m, RBDB.HasRedisBlockDB m, HasSQLDB m, MonadState Context m, MonadLogger m)
                 => Point
                 -> PPeer
                 -> Conduit Event m Message
handleMsgConduit myPubkey peer = do
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

