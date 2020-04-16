{-# LANGUAGE BangPatterns        #-}
{-# LANGUAGE FlexibleContexts    #-}
{-# LANGUAGE FlexibleInstances   #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell     #-}
{-# LANGUAGE TypeApplications    #-}
{-# LANGUAGE TypeOperators       #-}

module Executable.StratoP2PServer
  ( stratoP2PServer
  ) where

import           Blockchain.CommunicationConduit
import           Blockchain.Context
import           Blockchain.RLPx
import           Conduit
import           Control.Monad
import qualified Control.Monad.Change.Alter            as A
import qualified Control.Monad.Change.Modify           as Mod
import           Control.Monad.Reader
import           Control.Monad.Trans.Resource
import           Crypto.PubKey.ECC.DH
import           Data.Conduit.Network
import           Data.Maybe                            (fromMaybe)
import qualified Data.Text                             as T
import           Network.Wai.Handler.Warp.Internal     (setSocketCloseOnExec)
import           UnliftIO

import           Blockchain.ECIES
import           Blockchain.EthConf
import           Blockchain.Options
import           Blockchain.Output
import           Blockchain.P2PUtil
import           Blockchain.Strato.Discovery.Data.Peer
import qualified Text.Colors                           as C

runEthServer :: (MonadIO m, MonadLogger m, MonadUnliftIO m)
             => PrivateNumber
             -> Int
             -> m ()
runEthServer myPriv listenPort = do
  cfg <- initConfig myPriv flags_maxReturnedHeaders
  void . runContextM cfg $ ethServer listenPort

ethServer :: ( MonadP2P m
             , MonadUnliftIO m
             , MonadReader Config m
             , Mod.Accessible PrivateNumber m
             , A.Selectable String PPeer m
             , ((T.Text, Int) `A.Alters` ActivityState) m
             )
          => Int -> m ()
ethServer listenPort = do
  let settings = setAfterBind setSocketCloseOnExec $ serverSettings listenPort "*"
  runGeneralTCPServer settings ethServerHandler

ethServerHandler :: ( MonadP2P m
                    , MonadUnliftIO m
                    , MonadReader Config m
                    , Mod.Accessible PrivateNumber m
                    , A.Selectable String PPeer m
                    , ((T.Text, Int) `A.Alters` ActivityState) m
                    )
                 => AppData
                 -> m ()
ethServerHandler app = do
  let theSockAddr = sockAddrToIP (appSockAddr app)
  ender <- toIO . $logInfoS "runEthServer/exit" . T.pack . C.green $ " * Connection ended to " ++ C.yellow theSockAddr
  void $ register ender
  getPeerByIP theSockAddr >>= \case
    Nothing -> do
      $logErrorS "runEthServer" . T.pack $ "Didn't see peer in discovery at IP " ++ show theSockAddr ++ ". rejecting violently."
    Just p -> do
      case pPeerPubkey p of
        Nothing -> do
          $logErrorS "runEthServer" . T.pack $ "Didn't get pubkey during discovery for peer " ++ show theSockAddr  ++ ". rejecting violently."
        Just _ -> do
          (attempt :: Either SomeException ()) <- withActivePeer p $ runEthServerConduit p app
          case attempt of
            Right () -> $logDebugS "runEthServer" "Peer ran successfully!"
            Left err -> $logErrorS "runEthServer" . T.pack $ "Peer did not run successfully: " ++ show err

runEthServerConduit :: ( MonadP2P m
                       , MonadUnliftIO m
                       , MonadReader Config m
                       , Mod.Accessible PrivateNumber m
                       )
                    => PPeer
                    -> AppData
                    -> m (Either SomeException ())
runEthServerConduit p app = do
  myPriv <- Mod.access (Mod.Proxy @PrivateNumber)
  let myPubkey = calculatePublic theCurve myPriv
      otherPubKey = fromMaybe (error "programmer error: runEthServerConduit was called without a pubkey") $ pPeerPubkey p
  (_, (outCtx, inCtx)) <- liftIO $ appSource app $$+ ethCryptAccept myPriv otherPubKey `fuseUpstream` appSink app
  !eventSource <- mkEthP2PEventSource app inCtx (contextKafkaState initContext)
  !eventSink <- mkEthP2PEventConduit (show $ appSockAddr app) outCtx
  initState <- newIORef initContext
  try . local (\c -> c{configContext = initState})
      . runConduit $ eventSource
                  .| handleMsgServerConduit myPubkey p
                  .| eventSink
                  .| appSink app

stratoP2PServer :: LoggingT IO ()
stratoP2PServer = do
  let PrivKey myPriv = privKey ethConf

  $logInfoS "stratoP2PServer" $ T.pack $ "connect address: " ++ flags_address
  $logInfoS "stratoP2PServer" $ T.pack $ "listen port:     " ++ show flags_listen

  void $ runEthServer myPriv flags_listen
