{-# LANGUAGE OverloadedStrings          #-}
{-# LANGUAGE FlexibleInstances          #-}
{-# LANGUAGE FlexibleContexts           #-}
{-# LANGUAGE ScopedTypeVariables        #-}

module Blockchain.TCPServer (
  runEthServer
  ) where

import Control.Exception.Lifted

import           Conduit
import qualified Data.Conduit.List as CL
import           Data.Conduit.Network
import qualified Data.Conduit.Binary as CB
import qualified Data.Text as T

import Crypto.Types.PubKey.ECC

import           Control.Applicative
import Control.Concurrent.STM.MonadIO
import           Control.Monad
import           Control.Monad.Logger


import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import qualified Data.Set as S

import           Blockchain.CommunicationConduit
import           Blockchain.ContextLite
import           Blockchain.Data.RLP
import           Blockchain.Data.Wire
import           Blockchain.Display
import           Blockchain.Event
import           Blockchain.Frame
import           Blockchain.ExtMergeSources
import           Blockchain.BlockNotify
import           Blockchain.RawTXNotify
import           Blockchain.RLPx
import           Blockchain.Util

import qualified Data.ByteString.Lazy as BL

import           Data.Maybe
import           Control.Monad.State
import           Prelude 

import           Crypto.PubKey.ECC.DH

import qualified Database.Persist.Postgresql as SQL



import           Blockchain.Data.Peer

import           Blockchain.P2PUtil

               
theCurve::Curve
theCurve = getCurveByName SEC_p256k1

runEthServer::(MonadResource m, MonadIO m, MonadBaseControl IO m, MonadLogger m)=>
              TVar (S.Set String)->SQL.ConnectionString->PrivateNumber->Int->m ()
runEthServer connectedPeers connStr myPriv listenPort = do  
    cxt <- initContextLite connStr

    let myPubkey = calculatePublic theCurve myPriv

    createTXTrigger "tx"
    createBlockTrigger "p2p_block"
       
    runGeneralTCPServer (serverSettings listenPort "*") $ \app -> do
      logInfoN $ T.pack $ "|||| Incoming connection from " ++ show (appSockAddr app)
      _ <- modifyTVar connectedPeers (S.insert $ show $ appSockAddr app)
      peer <- fmap fst $ runResourceT $ flip runStateT cxt $ getPeerByIP (sockAddrToIP $ appSockAddr app)
      let unwrappedPeer = case (SQL.entityVal <$> peer) of 
                            Nothing -> error "peer is nothing after call to getPeerByIP"
                            Just peer' -> peer'
                          
      (_, (outCxt, inCxt)) <-
            liftIO $
            appSource app $$+
            ethCryptAccept myPriv (fromMaybe (error "connecting peer didn't send me its pubkey") $ pPeerPubkey unwrappedPeer) `fuseUpstream`
            appSink app

      runEthCryptMLite cxt $ do
        let rSource = appSource app
            txSource = txNotificationSource "tx"
                      =$= CL.map NewTX
            blockSource = blockNotificationSource "p2p_block"
                      =$= CL.map (uncurry NewBL)

        eventSource <- mergeSourcesCloseForAny [
          rSource =$=
          appSource app =$=
          ethDecrypt inCxt =$=
          transPipe liftIO bytesToMessages =$=
          transPipe lift (tap (displayMessage False (show $ appSockAddr app))) =$=
          CL.map MsgEvt,
          blockSource,
          txSource
          ] 2


        logInfoN "server session starting"

        (_::Either SomeException ()) <- try $ 
                 eventSource =$=
                   handleMsgConduit myPubkey unwrappedPeer =$=
                   transPipe lift (tap (displayMessage True (show $ appSockAddr app))) =$=
                   messagesToBytes =$=
                   ethEncrypt outCxt $$
                   transPipe liftIO (appSink app)

        logInfoN "server session ended"

        _ <- modifyTVar connectedPeers (S.delete $ show $ appSockAddr app)

        return ()


--cbSafeTake::Monad m=>Int->Consumer B.ByteString m B.ByteString
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
