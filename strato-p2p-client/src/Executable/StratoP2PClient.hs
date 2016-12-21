{-# LANGUAGE FlexibleContexts, ScopedTypeVariables, PatternGuards, OverloadedStrings #-}

module Executable.StratoP2PClient (
  stratoP2PClient
  ) where

import Control.Concurrent hiding (yield)
import Control.Concurrent.STM.MonadIO
import Control.Exception.Lifted
import Control.Monad.IO.Class
import Control.Monad.Logger
import Control.Monad.State
import Control.Monad.Trans.Resource
import Crypto.PubKey.ECC.DH
import Crypto.Types.PubKey.ECC
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Lazy as BL
import Data.Conduit
import qualified Data.Conduit.Binary as CB
import qualified Data.Conduit.List as CL
import Data.Conduit.Network
import qualified Database.Persist.Postgresql as SQL
import qualified Data.Set as S
import qualified Data.Text as T
import qualified Network.Haskoin.Internals as H
import System.Random

import Blockchain.Frame
import Blockchain.UDP
import Blockchain.RLPx

import Blockchain.BlockNotify
import qualified Blockchain.Colors as C
--import Blockchain.Communication
import Blockchain.Constants
import Blockchain.Context
import Blockchain.Data.BlockDB
import Blockchain.Data.Extra
import Blockchain.Data.Peer
import Blockchain.Data.RLP
--import Blockchain.Data.SignedTransaction
import Blockchain.Data.Wire
import Blockchain.DB.DetailsDB
import Blockchain.DB.SQLDB
--import Blockchain.DB.ModifyStateDB
import Blockchain.Display
import Blockchain.EthConf hiding (genesisHash,port)
import Blockchain.EthEncryptionException
import Blockchain.Event
import Blockchain.EventException
import Blockchain.ExtMergeSources
import Blockchain.Format
import Blockchain.Options
import Blockchain.PeerUrls
import Blockchain.RawTXNotify
--import Blockchain.SampleTransactions
import Blockchain.Stream.VMEvent
import Blockchain.TCPClientWithTimeout
import Blockchain.TimerSource
import Blockchain.Util
import Executable.StratoP2PClientComm

--import Debug.Trace

import Data.Maybe


awaitMsg::MonadIO m=>
          ConduitM Event Message m (Maybe Message)
awaitMsg = do
  x <- await
  case x of
   Just (MsgEvt msg) -> return $ Just msg
   Nothing -> return Nothing
   _ -> awaitMsg

handleMsg::(MonadIO m, MonadState Context m, HasSQLDB m, MonadLogger m)=>
           Point->PPeer->Conduit Event m Message
handleMsg myId peer = do
  yield $ Hello {
              version = 4,
              clientId = stratoVersionString,
              capability = [ETH ethVersion], -- , SHH shhVersion],
              port = 0,
              nodeId = myId
            }

  helloResponse <- awaitMsg

  case helloResponse of
   Just Hello{} -> do
     bestBlock <- lift getBestBlock
     genesisBlockHash <- lift getGenesisHash
     yield Status{
       protocolVersion=fromIntegral ethVersion,
       networkID=if flags_cNetworkID == -1
                 then (if flags_cTestnet then 0 else 1) 
                 else flags_cNetworkID,
                      totalDifficulty=0,
       latestHash=blockHash bestBlock,
       genesisHash=genesisBlockHash
       }
   Just e -> throwIO $ EventBeforeHandshake e
   Nothing -> throwIO $ PeerDisconnected

  statusResponse <- awaitMsg

  case statusResponse of
   Just Status{latestHash=_, genesisHash=gh} -> do
     genesisBlockHash <- lift getGenesisHash
     when (gh /= genesisBlockHash) $ throwIO WrongGenesisBlock
--     lastBlockNumber <- liftIO $ fmap (maximum . map (blockDataNumber . blockBlockData)) $ fetchLastBlocks fetchLimit

     lastBlockNumber <- liftIO $ getBestKafkaBlockNumber

     Just (ChainBlock firstBlock:_) <- liftIO $ fetchVMEventsIO 0

     yield $ GetBlockHeaders (BlockNumber (max (lastBlockNumber - flags_syncBacktrackNumber) (blockDataNumber $ blockBlockData firstBlock))) maxReturnedHeaders 0 Forward
     stampActionTimestamp
   Just e -> throwIO $ EventBeforeHandshake e
   Nothing -> throwIO $ PeerDisconnected

  handleEvents peer





{-
createTransaction::Transaction->ContextM SignedTransaction
createTransaction t = do
    userNonce <- lift $ addressStateNonce <$> getAddressState (prvKey2Address prvKey)
    liftIO $ withSource devURandom $ signTransaction prvKey t{tNonce=userNonce}

createTransactions::[Transaction]->ContextM [SignedTransaction]
createTransactions transactions = do
    userNonce <- lift $ addressStateNonce <$> getAddressState (prvKey2Address prvKey)
    forM (zip transactions [userNonce..]) $ \(t, n) -> do
      liftIO $ withSource devURandom $ signTransaction prvKey t{tNonce=n}

doit::Point->ContextM ()
doit myPublic = do
    liftIO $ putStrLn "Connected"

    --lift $ addCode B.empty --This is probably a bad place to do this, but I can't think of a more natural place to do it....  Empty code is used all over the place, and it needs to be in the database.
    --lift (setStateDBStateRoot . blockDataStateRoot . blockBlockData =<< getBestBlock)

  --signedTx <- createTransaction simpleTX
  --signedTx <- createTransaction outOfGasTX
  --signedTx <- createTransaction simpleStorageTX
  --signedTx <- createTransaction createContractTX
  --signedTx <- createTransaction sendMessageTX

  --signedTx <- createTransaction createContractTX
  --signedTx <- createTransaction paymentContract
  --signedTx <- createTransaction sendCoinTX
  --signedTx <- createTransaction keyValuePublisher
  --signedTx <- createTransaction sendKeyVal

  --liftIO $ print $ whoSignedThisTransaction signedTx

                
  --sendMessage socket $ Transactions [signedTx]

  --signedTxs <- createTransactions [createMysteryContract]
  --liftIO $ sendMessage socket $ Transactions signedTxs
-}


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

bytesToMessages::Monad m=>Conduit B.ByteString m Message
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
             
theCurve::Curve
theCurve = getCurveByName SEC_p256k1

{-
hPubKeyToPubKey::H.PubKey->Point
hPubKeyToPubKey pubKey = Point (fromIntegral x) (fromIntegral y)
  where
    x = fromMaybe (error "getX failed in prvKey2Address") $ H.getX hPoint
    y = fromMaybe (error "getY failed in prvKey2Address") $ H.getY hPoint
    hPoint = H.pubKeyPoint pubKey
-}
  
runPeer::(MonadIO m, MonadBaseControl IO m, MonadLogger m, MonadThrow m)=>
         TVar (S.Set String)->PPeer->PrivateNumber->m ()
runPeer connectedPeers peer myPriv = do
  let otherPubKey = fromMaybe (error "programmer error- runPeer was called without a pubkey") $ pPeerPubkey peer
  logInfoN $ T.pack $ C.blue "Welcome to strato-p2p-client"
  logInfoN $ T.pack $ C.blue "============================"
  logInfoN $ T.pack $ C.green " * " ++ "Attempting to connect to " ++ C.yellow (T.unpack (pPeerIp peer) ++ ":" ++ show (pPeerTcpPort peer))

  let myPublic = calculatePublic theCurve myPriv
  logInfoN $ T.pack $ C.green " * " ++ "my pubkey is: " ++ format myPublic
  --logInfoN $ T.pack $ "my NodeID is: " ++ (format $ pointToByteString $ hPubKeyToPubKey $ H.derivePubKey $ fromMaybe (error "invalid private number in main") $ H.makePrvKey $ fromIntegral myPriv)

  logInfoN $ T.pack $ C.green " * " ++ "server pubkey is : " ++ format otherPubKey

  --cch <- mkCache 1024 "seed"

  runTCPClientWithConnectTimeout (clientSettings (pPeerTcpPort peer) $ BC.pack $ T.unpack $ pPeerIp peer) 5 $ \server -> 
      runResourceT $ do
      
        let peerString = show (pPeerIp peer) ++ ":" ++ show (pPeerTcpPort peer)

        _ <- modifyTVar connectedPeers $ S.insert peerString

        pool <- runNoLoggingT $ SQL.createPostgresqlPool
                connStr' 20

        _ <- flip runStateT (Context pool [] [] Nothing) $ do
          (_, (outCxt, inCxt)) <- liftIO $ 
            appSource server $$+
            ethCryptConnect myPriv otherPubKey `fuseUpstream`
            appSink server
            
          eventSource <- mergeSourcesCloseForAny [
            appSource server =$=
            ethDecrypt inCxt =$=
            bytesToMessages =$=
            tap (displayMessage False "") =$=
            CL.map MsgEvt,
            txNotificationSource "client_tx" =$= CL.map NewTX,
            blockNotificationSource "client_block" =$= CL.map (flip NewBL 0 . fst),
            timerSource
            ] 2

          eventSource =$=
            handleMsg myPublic peer =$=
            transPipe lift (tap (displayMessage True "")) =$=
            messagesToBytes =$=
            ethEncrypt outCxt $$
            transPipe liftIO (appSink server)

          _ <- modifyTVar connectedPeers $ S.delete peerString

          return ()

        return ()

getPubKeyRunPeer::(MonadIO m, MonadBaseControl IO m, MonadLogger m, MonadThrow m)=>
                  TVar (S.Set String)->PPeer->m ()
getPubKeyRunPeer connectedPeers peer = do
  let PrivKey myPriv = privKey ethConf

  case pPeerPubkey peer of
    Nothing -> do
      logInfoN $ T.pack $ "Attempting to connect to " ++ T.unpack (pPeerIp peer) ++ ":" ++ show (pPeerTcpPort peer) ++ ", but I don't have the pubkey.  I will try to use a UDP ping to get the pubkey."
      eitherOtherPubKey <- liftIO $ getServerPubKey (fromMaybe (error "invalid private number in main") $ H.makePrvKey $ fromIntegral myPriv) (T.unpack $ pPeerIp peer) (fromIntegral $ pPeerTcpPort peer)
      case eitherOtherPubKey of
            Right otherPubKey -> do
              logInfoN $ T.pack $ "#### Success, the pubkey has been obtained: " ++ format otherPubKey
              runPeer connectedPeers peer{pPeerPubkey=Just otherPubKey} myPriv
            Left e -> logInfoN $ T.pack $ "Error, couldn't get public key for peer: " ++ show e
    Just _ -> runPeer connectedPeers peer myPriv
                      

runPeerInList::(MonadIO m, MonadBaseControl IO m, MonadLogger m, MonadThrow m)=>
               --[(String, PortNumber, Maybe Point)]->Maybe Int->m ()
               TVar (S.Set String)->[PPeer]->Int->m ()
runPeerInList connectedPeers peers peerNumber = do

  let thePeer = peers !! peerNumber

  liftIO $ disablePeerForSeconds thePeer 60 --don't connect to a peer more than once per minute, out of politeness
  
  getPubKeyRunPeer connectedPeers thePeer
               
stratoP2PClient::[String]->LoggingT IO ()    
stratoP2PClient args = do
  let maybePeerNumber =
        case args of
          [] -> Nothing
          [x] -> return $ read x
          _ -> error "usage: ethereumH [servernum]"


  connectedPeers <- newTVar S.empty
  
  _ <- liftIO $ forkIO $ runStratoP2PClientComm connectedPeers

  forever $ do
    peers <-
      if flags_sqlPeers
      then liftIO getAvailablePeers
      else return $ map (\(ip, port') -> defaultPeer{pPeerIp=T.pack ip, pPeerTcpPort=fromIntegral port'}) ipAddresses

    case peers of
     [] -> do
       logInfoN "No available peers, I will try to find available peers again in 10 seconds"
       liftIO $ threadDelay 10000000
     _ -> do
       peerNumber <-
         case maybePeerNumber of
          Just x -> return x
          Nothing -> liftIO $ randomRIO (0, length peers - 1)
       result <- try $ runPeerInList connectedPeers peers peerNumber
       case result of
        Left e | Just (ErrorCall x) <- fromException e -> error x
        Left e -> do
          logInfoN $ T.pack $ "Connection ended: " ++ show (e::SomeException)
          case e of
           e' | Just TimeoutException <- fromException e' ->
                  liftIO $ disablePeerForSeconds (peers !! peerNumber) $ 60*60*4
           e' | Just WrongGenesisBlock <- fromException e' ->
                  liftIO $ disablePeerForSeconds (peers !! peerNumber) $ 60*60*24*7
           e' | Just HeadMacIncorrect <- fromException e' ->
                  liftIO $ disablePeerForSeconds (peers !! peerNumber) $ 60*60*24
           _ -> return ()
        Right _ -> return ()
       when (isJust maybePeerNumber) $ liftIO $ threadDelay 1000000

