{-# LANGUAGE FlexibleContexts    #-}
{-# LANGUAGE FlexibleInstances   #-}
{-# LANGUAGE LambdaCase          #-}
{-# LANGUAGE MonoLocalBinds      #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RankNTypes          #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell     #-}
{-# LANGUAGE TypeApplications    #-}
{-# LANGUAGE TypeOperators       #-}

module Executable.StratoP2PServer
  ( stratoP2PServer,
    runEthServerConduit,
  )
where

import           BlockApps.Logging
import           Blockchain.CommunicationConduit
import           Blockchain.Context                    hiding (Inbound,
                                                        Outbound)
import           Blockchain.Data.PubKey                (secPubKeyToPoint)
import           Blockchain.Display                    (MsgDirection (..),
                                                        displayMessage)
import           Blockchain.EthEncryptionException
import           Blockchain.Event
import           Blockchain.EventException
import           Blockchain.ExtMergeSources
import           Blockchain.Frame
import           Blockchain.Metrics
import           Blockchain.Options
import           Blockchain.EthConf (ethConf, p2pConfig)
import qualified Blockchain.EthConf.Model as Conf
import           Blockchain.RLPx
import           Blockchain.Sequencer.Event
import           Blockchain.Strato.Discovery.Data.Peer
import           Blockchain.Strato.Model.Host
import           Blockchain.Threads
import           Blockchain.TimerSource
import           Conduit
import           Control.Lens                          ((^.))
import           Control.Monad
import           Control.Monad.Composable.Vault
import           Control.Monad.Trans.Resource
import           Crypto.Types.PubKey.ECC               (Point)
import qualified Data.ByteString                       as B
import qualified Data.Conduit.List                     as CL
import           Data.Default                          (def)
import           Data.Either.Combinators
import qualified Data.Text                             as T
import           Data.Time.Clock (NominalDiffTime)
import qualified Text.Colors                           as C
import           Text.Read                             (readMaybe)
import           UnliftIO

runEthServer ::
  (RunsServer m, MonadP2P m) =>
  Int ->
  PeerRunner m () ->
  IO ()
runEthServer listenPort runner =
  runServer (TCPPort listenPort) runner $ \c a p ->
    ethServerHandler (c ^. peerSource) (c ^. peerSink) (c ^. seqSource) a p

ethServerHandler ::
  MonadP2P m =>
  ConduitM () B.ByteString m () ->
  ConduitM B.ByteString Void m () ->
  ConduitM () P2pEvent m () ->
  Host ->
  TCPPort ->
  m ()
ethServerHandler pSource pSink seqSrc host (TCPPort port) = do
  -- The label carries the connection's source port, so two connections from
  -- one address (a peer reconnecting while its last session winds down, two
  -- nodes behind one NAT) are two peers to "Blockchain.Threads", not one
  -- mangled group that the connection limit and /connections count as none.
  let peerStr = "<" ++ hostToString host ++ ":" ++ show port
  ender <- toIO . $logInfoS "runEthServer/exit" . T.pack . C.green $ " * Connection ended to " ++ C.yellow peerStr
  void $ register ender
  -- The peer as this connection presents it, with its source port; the
  -- session is recorded against the stored peers once its Hello has
  -- authenticated the key, inside runEthServerConduit.
  p <- getPeerByIP host >>= \case
    Nothing -> pure def{pPeerHost = host, pPeerIp = readMaybe (hostToString host), pPeerTcpPort = port}
    Just p -> pure p{pPeerTcpPort = port}
  (p', attempt) <- runEthServerConduit host p pSource pSink seqSrc peerStr
  case (,) <$> pPeerPubkey p' <*> attempt of
    Nothing  -> $logDebugS "runEthServer" "Peer ran successfully!"
    Just (pubkey, err) -> do
      $logErrorS "runEthServer" . T.pack $ "Peer did not run successfully: " ++ show err
      -- p carries this connection's source port, but stored peers are matched
      -- by (host, listening port), so a disable through p reaches no record.
      -- The stored records are found by the address and the key instead.
      case err of
        e' | Just WrongGenesisBlock <- fromException e' ->
          disableStoredInboundPeer host pubkey "WrongGenesisBlock" True
        e' | Just NetworkIDMismatch <- fromException e' ->
          disableStoredInboundPeer host pubkey "NetworkIDMismatch" True
        e' | Just NoPeerCertificate <- fromException e' ->
          disableStoredInboundPeer host pubkey "NoPeerCertificate" False
        e' | Just SelfConnection <- fromException e' -> do
          $logErrorS "runEthServer" . T.pack $ "Inbound peer " ++ hostToString host ++ " presents this node's key: our own public address, or another node running with this node's key"
          -- Every record of the address is banned, whatever key it carries:
          -- the self endpoint may be stored under a DNS name and under its
          -- IP, with this node's key or with none.
          stored <- getPeersByIP host
          forM_ stored $ \s -> do
            disErr <- storeDisableException s (T.pack "SelfConnection")
            whenLeft disErr $ \err2 -> $logErrorS "stratoP2PServer/runEthServer" . T.pack $ "Unable to store disable exception: " ++ show err2
            selfErr <- disableTCPPeerForSeconds s 86400
            whenLeft selfErr $ \theSelfErr -> do
              $logErrorLS "stratoP2PServer/runEthServer" theSelfErr
        -- Anything else says nothing against dialing the stored peer, so it
        -- gets no disable and this node's own dials to it stay on the client
        -- loop's schedule: PeerDisconnected (the peer hung up, perhaps to
        -- restart), CurrentlyTooManyPeers (this node is full; the peer is
        -- fine, and it backs off on its own side), HeadMacIncorrect (a frame
        -- failed to authenticate, so the key is a claim and no stored record
        -- is known to be the sender's), an IOError (the path to the peer
        -- failed) and a handshake timeout.
        _ -> return ()
      throwIO err

-- | Run an accepted connection from the given remote address, whose stored
-- peer (if any) is @p@.
runEthServerConduit ::
  MonadP2P m =>
  Host ->
  PPeer ->
  ConduitM () B.ByteString m () ->
  ConduitM B.ByteString Void m () ->
  ConduitM () P2pEvent m () ->
  String ->
  m (PPeer, Maybe SomeException)
runEthServerConduit remote p pSource pSink seqSrc peerStr = labelPeerThread peerStr "Peer Manager" (Just "HANDSHAKING") $ do
  myPubKey' <- getPub
  let myPubkey = secPubKeyToPoint myPubKey'
  mConnectionResult <- timeout 2000000 $ pSource $$+ ethCryptAccept `fuseUpstream` pSink
  case mConnectionResult of
    Nothing -> pure (p, Just $ toException $ HandshakeException "handshake timed out")
    Just (_, (otherPubKey, outCtx, inCtx)) -> do
      changeLabelStatusM "CONNECTED"
      -- The key is a claim until the first frame authenticates it, which the
      -- Hello does, so the handler records the session against the stored
      -- peers only then (see 'markInboundPeerActive'), once the connection
      -- is admitted and the key is not this node's own. The mark is dropped
      -- on the way out only if it was set: a connection that failed before
      -- its Hello proved nothing about any stored record, and another
      -- session with the peer may be holding the mark. Mark and flag are
      -- set under mask: a source failing in the merge cancels the handler,
      -- and a cancellation between the two would leave the mark in place
      -- after the session, with the peer never dialed again.
      inSession <- newIORef False
      let p' = p{pPeerPubkey = Just otherPubKey}
          recordSession = mask_ $ do
            markInboundPeerActive remote otherPubKey
            writeIORef inSession True
          endSession = do
            recorded <- readIORef inSession
            when recorded $ markInboundPeerInactive remote otherPubKey
      ret <-
        (`finally` endSession) . fmap (either Just (const Nothing)) . try $
        [ labelPeerThread peerStr "Peer Source" Nothing $
          pSource
          .| ethDecrypt inCtx
          .| CL.iterM (recordTraffic Inbound)
          .| bytesToMessages
          .| CL.iterM (displayMessage Inbound peerStr)
          .| CL.map MsgEvt
        , labelPeerThread peerStr "Sequencer Source" Nothing $
          seqSrc
          .| CL.map NewSeqEvent
        , labelPeerThread peerStr "Timer Source" Nothing timerSource
        ] `mergeConnect` (
        CL.iterM recordEvent
          .| labelPeerThread peerStr "P2P Handler" Nothing (handleMsgServerConduit myPubkey p' recordSession)
          .| debounceTxSendsAndUnseq
          .| CL.iterM recordMessage
          .| CL.iterM (displayMessage Outbound peerStr)
          .| messageToBytes
          .| CL.iterM (recordTraffic Outbound)
          .| ethEncrypt outCtx
          .| pSink
        )

      case ret of
        Nothing -> changeLabelStatusM "DISCONNECTING"
        Just e  -> changeLabelStatusM $ "DISCONNECTING: " ++ show e

      return (p', ret)

stratoP2PServer ::
  (MonadP2P m, RunsServer m) =>
  PeerRunner m () ->
  IO ()
stratoP2PServer runner = labelTheThread "stratoP2PServer" . runner $ \_ -> do
  $logInfoS "stratoP2PServer" $ T.pack $ "connect address: " ++ flags_address
  let listenPort' = Conf.listenPort (p2pConfig ethConf)
  $logInfoS "stratoP2PServer" $ T.pack $ "listen port:     " ++ show listenPort'
  liftIO $ runEthServer listenPort' runner

logAndLengthenPeerDisableBy :: MonadP2P m => NominalDiffTime -> PPeer -> m (Either SomeException ())
logAndLengthenPeerDisableBy disableBy peer = do
  $logInfoS "logAndLengthenPeerDisableBy" $ T.pack $ "Disabling Peer " ++ show (pPeerHost peer) ++ ", exponential reset will occur in " ++ show disableBy ++ " seconds"
  lengthenPeerDisableBy disableBy peer

-- | The stored records of the peer with this key at this address: under the
-- address itself and under any name stored for it (a peer can be stored
-- under both), never a record with another key, since several peers can
-- share a host. Each record carries its own listening port, which the
-- disable helpers match on.
storedPeersWithKey :: MonadP2P m => Host -> Point -> m [PPeer]
storedPeersWithKey host pubkey = filter ((== Just pubkey) . pPeerPubkey) <$> getPeersByIP host

-- | Disable the stored records of an accepted peer that the ETH handshake
-- proved is no peer for this node, as the client loop disables a dialed one
-- it proves the same about: the exponential TCP disable with its day-long
-- window, bond state 3 for a peer on another chain, and a day without
-- discovery pings. The UDP disable goes last, as in the client loop: the
-- TCP disable writes its own deadline into udp_enable_time as well, and
-- would cut the day down to the first five-second window, after which
-- discovery's next Pong bonds the peer again; the UDP disable then moves
-- the stored deadline out to the day whatever the row showed when it was
-- read. A peer with no record is left without one: it is not dialed anyway.
disableStoredInboundPeer :: MonadP2P m => Host -> Point -> T.Text -> Bool -> m ()
disableStoredInboundPeer host pubkey why wrongChain = do
  stored <- storedPeersWithKey host pubkey
  when (null stored) $
    $logInfoS "stratoP2PServer/runEthServer" . T.pack $ "No stored record of the peer at " ++ hostToString host ++ " under its key; nothing to disable for " ++ T.unpack why
  forM_ stored $ \s -> do
    disErr <- storeDisableException s why
    whenLeft disErr $ \err2 -> $logErrorS "stratoP2PServer/runEthServer" . T.pack $ "Unable to store disable exception: " ++ show err2
    void $ logAndLengthenPeerDisableBy (24 * 60 * 60) s
    when wrongChain $ do
      bondErr <- setPeerBondingState (pPeerHost s) pubkey 3 -- 3 indicates wrong genesis block/networkID
      whenLeft bondErr $ \err2 -> $logErrorS "stratoP2PServer/runEthServer" . T.pack $ "Unable to set peer bonding state: " ++ show err2
    udpErr <- disableUDPPeerForSeconds s 86400
    whenLeft udpErr $ \theUDPErr -> do
      $logErrorLS "stratoP2PServer/runEthServer" theUDPErr
