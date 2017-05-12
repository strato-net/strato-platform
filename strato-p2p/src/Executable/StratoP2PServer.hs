{-# LANGUAGE FlexibleContexts    #-}
{-# LANGUAGE FlexibleInstances   #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell     #-}

module Executable.StratoP2PServer (
  stratoP2PServer
  ) where

import           Control.Concurrent                    hiding (yield)
import           Control.Concurrent.STM.MonadIO
import           Control.Monad.IO.Class
import           Control.Monad.Trans.Resource
import qualified Data.Set                              as S

import           Blockchain.CommunicationConduit
import           Control.Exception.Lifted

import           Conduit
import qualified Data.Conduit.Binary                   as CB
import qualified Data.Conduit.List                     as CL
import           Data.Conduit.Network
import qualified Data.Text                             as T

import           Crypto.Types.PubKey.ECC

import           Control.Applicative
import           Control.Monad
import           Control.Monad.Logger

import qualified Data.ByteString                       as B
import qualified Data.ByteString.Char8                 as BC

import           Blockchain.ContextLite
import           Blockchain.Data.RLP
import           Blockchain.Data.Wire
import           Blockchain.Display
import           Blockchain.Event
import           Blockchain.ExtMergeSources
import           Blockchain.Frame
import           Blockchain.RLPx
import           Blockchain.SeqEventNotify
import           Blockchain.Util

import           Control.Monad.State
import           Crypto.PubKey.ECC.DH
import qualified Data.ByteString.Lazy                  as BL
import           Data.Maybe
import qualified Database.Persist.Postgresql           as SQL
import           Prelude

import           Blockchain.P2PRPC
import           Blockchain.P2PUtil
import           Blockchain.Strato.Discovery.Data.Peer

import           Blockchain.EthConf
import           Blockchain.ServOptions


theCurve :: Curve
theCurve = getCurveByName SEC_p256k1

runEthServer :: (MonadResource m, MonadIO m, MonadBaseControl IO m, MonadLogger m)
             => TVar (S.Set ConnectedPeer) -> PrivateNumber -> Int -> m ()
runEthServer connectedPeers myPriv listenPort = do
    cxt <- initContextLite

    let myPubkey = calculatePublic theCurve myPriv

    runGeneralTCPServer (serverSettings listenPort "*") $ \app -> do
      $logInfoS "runEthServer" $ T.pack $ "|||| Incoming connection from " ++ show (appSockAddr app)
      peer <- fmap fst $ runResourceT $ flip runStateT cxt $ getPeerByIP (sockAddrToIP $ appSockAddr app)
      let unwrappedPeer = case (SQL.entityVal <$> peer) of
                            Nothing    -> error "peer is nothing after call to getPeerByIP"
                            Just peer' -> peer'
          cp = ConnectedPeer unwrappedPeer
      _ <- modifyTVar connectedPeers (S.insert cp)
      (_, (outCxt, inCxt)) <-
            liftIO $
            appSource app $$+
            ethCryptAccept myPriv (fromMaybe (error "connecting peer didn't send me its pubkey") $ pPeerPubkey unwrappedPeer) `fuseUpstream`
            appSink app

      runEthCryptMLite cxt $ do

        eventSource <- mergeSourcesCloseForAny [
              appSource app
                =$= ethDecrypt inCxt
                =$= transPipe liftIO bytesToMessages
                =$= transPipe lift (tap (displayMessage False (show $ appSockAddr app)))
                =$= CL.map MsgEvt
            , seqEventNotifictationSource =$= CL.map NewSeqEvent
          ] 2

        $logInfoS "runEthServer" "server session starting"

        (_::Either SomeException ()) <- try $
              eventSource
                =$= handleMsgConduit myPubkey unwrappedPeer
                =$= transPipe lift (tap (displayMessage True (show $ appSockAddr app)))
                =$= messagesToBytes
                =$= ethEncrypt outCxt
                 $$ transPipe liftIO (appSink app)

        $logInfoS "runEthServer" "server session ended"

        _ <- modifyTVar connectedPeers (S.delete cp)

        return ()


cbSafeTake::Monad m=>Int->ConduitM BC.ByteString o m BC.ByteString
cbSafeTake i = do
  ret <- fmap BL.toStrict $ CB.take i
  if B.length ret /= i
    then error "safeTake: not enough data"
    else return ret

getRLPData::Monad m=>Consumer B.ByteString m B.ByteString
getRLPData = do
  first <- fmap (fromMaybe $ error "no rlp data") CB.head
  case first of
   x | x < 128 -> return $ B.singleton x
   x | x >= 192 && x <= 192+55 -> do
         rest <- cbSafeTake $ fromIntegral $ x - 192
         return $ x `B.cons` rest
   x | x >= 0xF8 && x <= 0xFF -> do
         length' <- cbSafeTake $ fromIntegral x-0xF7
         rest <- cbSafeTake $ fromIntegral $ bytes2Integer $ B.unpack length'
         return $ x `B.cons` length' `B.append` rest
   x -> error $ "missing case in getRLPData: " ++ show x


bytesToMessages::Conduit B.ByteString IO Message
bytesToMessages = forever $ do
    msgTypeData <- cbSafeTake 1
    let word = fromInteger (rlpDecode $ rlpDeserialize msgTypeData::Integer)

    objBytes <- getRLPData
    yield $ obj2WireMessage word $ rlpDeserialize objBytes

messagesToBytes::Monad m=>Conduit Message m B.ByteString
messagesToBytes = do
    maybeMsg <- await
    case maybeMsg of
     Nothing -> return ()
     Just msg -> do
        let (theWord, o) = wireMessage2Obj msg
        yield $ theWord `B.cons` rlpSerialize o
        messagesToBytes

stratoP2PServer :: LoggingT IO ()
stratoP2PServer = do
  let PrivKey myPriv = privKey ethConf
  connectedPeers <- newTVar S.empty

  $logInfoS "stratoP2PServer" $ T.pack $ "connect address: " ++ (flags_address)
  $logInfoS "stratoP2PServer" $ T.pack $ "listen port:     " ++ (show flags_listen)
  $logInfoS "stratoP2PClient" $ T.pack $ "serverCommPort: " ++ show serverCommPort

  _ <- liftIO $ forkIO $ runStratoP2PComm serverCommPort connectedPeers
  _ <- runResourceT $ do
          runEthServer connectedPeers myPriv flags_listen
  return ()

