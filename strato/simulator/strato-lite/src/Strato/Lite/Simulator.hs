{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE PackageImports #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE Rank2Types #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE UndecidableInstances #-}
{-# LANGUAGE NoMonomorphismRestriction #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Strato.Lite.Simulator where

import BlockApps.X509.Certificate as X509
import qualified Blockchain.Data.AlternateTransaction as U
import Blockchain.Data.BlockDB ()
-- import Blockchain.Data.GenesisInfo
import Blockchain.Data.Transaction (getSigVals)
import Blockchain.Data.TransactionDef
import Blockchain.GenesisBlocks.Contracts.CertRegistry
import Blockchain.GenesisBlocks.Contracts.GovernanceV2
import Blockchain.GenesisBlocks.HeliumGenesisBlock as Helium
import Blockchain.Sequencer.Event
import Blockchain.Strato.Discovery.Data.Peer
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Code
import Blockchain.Strato.Model.Gas
import Blockchain.Strato.Model.Host
import Blockchain.Strato.Model.Nonce
import Blockchain.Strato.Model.Secp256k1
import Blockchain.Strato.Model.Validator
import Blockchain.Strato.Model.Wei
import Conduit
import Control.Concurrent.STM.TMChan
import Control.Lens hiding (Context, view)
import Control.Monad (when)
import Control.Monad.Reader
import Control.Monad.Trans.Except
import Control.Monad.Trans.Maybe
import Data.Bifunctor (first)
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import Data.Conduit.TMChan
import Data.Conduit.TQueue hiding (newTQueueIO)
import Data.Default
import Data.Foldable (traverse_)
import Data.Map.Strict (Map)
import qualified Data.Map.Strict as M
import Data.Maybe (fromJust, isJust)
import Data.Text (Text)
import qualified Data.Text as T
import Data.Traversable (for)
import Executable.StratoP2PClient 
import Executable.StratoP2PServer (runEthServerConduit)
import Strato.Lite.Base
import Strato.Lite.Base.Simulator
import Strato.Lite.Core
import UnliftIO
import Prelude hiding (round)

data SimulatorP2PConnection = SimulatorP2PConnection
  { _serverToClient :: TQueue B.ByteString
  , _clientToServer :: TQueue B.ByteString
  , _serverSimulatorPeer :: (SimulatorPeer, CorePeer)
  , _clientSimulatorPeer :: (SimulatorPeer, CorePeer)
  , _server :: CoreT SimulatorM (Maybe SomeException)
  , _client :: CoreT SimulatorM (Maybe SomeException)
  , _serverException :: TVar (Maybe SomeException)
  , _clientException :: TVar (Maybe SomeException)
  }

makeLenses ''SimulatorP2PConnection

data Network = Network
  { _nodes :: Map Text (SimulatorPeer, CorePeer),
    _connections :: Map (Text, Text) SimulatorP2PConnection,
    _internet :: TVar Internet
  }

makeLenses ''Network

data ThreadPool = ThreadPool
  { _nodeThreads :: Map Text (Async ()),
    _connectionThreads :: Map (Text, Text) (Async ())
  }

makeLenses ''ThreadPool

data NetworkManager = NetworkManager
  { _threads :: TVar ThreadPool
  , _network :: TVar Network
  , _initialCerts :: [X509Certificate]
  , _initialValidators :: [(Address, Validator)]
  }

makeLenses ''NetworkManager

createSimulatorPeerAndCorePeer ::
  String ->
  PrivateKey ->
  Validator ->
  [(Address, Validator)] ->
  [X509Certificate] ->
  TVar Internet ->
  Text ->
  Host ->
  TCPPort ->
  UDPPort ->
  [Host] ->
  Bool ->
  IO (SimulatorPeer, CorePeer)
createSimulatorPeerAndCorePeer network' privKey selfId initialValidators' extraCerts inet name ipAsText tcpPort udpPort bootNodes valBehav = do
  simPeer <- createSimulatorPeer privKey inet ipAsText tcpPort udpPort bootNodes
  let vals = snd <$> initialValidators'
      genesisInfo = insertMercataGovernanceContract vals ((\(Validator v) -> v) <$> take 1 vals) $ insertCertRegistryContract extraCerts Helium.genesisBlock
  corePeer <- createCorePeer network' (T.unpack name) selfId genesisInfo valBehav
  pure (simPeer, corePeer)

createSimulatorConnection ::
  (SimulatorPeer, CorePeer) ->
  (SimulatorPeer, CorePeer) ->
  IO SimulatorP2PConnection
createSimulatorConnection server' client' = createSimulatorConnectionWithModifications server' client' id id

createSimulatorConnectionWithModifications ::
  (SimulatorPeer, CorePeer) ->
  (SimulatorPeer, CorePeer) ->
  (P2pEvent -> P2pEvent) ->
  (P2pEvent -> P2pEvent) ->
  IO SimulatorP2PConnection
createSimulatorConnectionWithModifications server'' client'' modifyServerMsgs modifyClientMsgs = do
  let (ss, server') = server''
      (cs, client') = client''
  serverToClientTQueue <- newTQueueIO
  clientToServerTQueue <- newTQueueIO
  serverSeqSource <- atomically . dupTMChan $ _corePeerSeqP2pSource server'
  clientSeqSource <- atomically . dupTMChan $ _corePeerSeqP2pSource client'
  serverCtx <- newIORef (def :: P2PContext)
  clientCtx <- newIORef (def :: P2PContext)
  serverExceptionTVar <- newTVarIO Nothing
  clientExceptionTVar <- newTVarIO Nothing
  let pubkeystr s = BC.unpack $ B16.encode $ B.drop 1 $ exportPublicKey False (derivePublicKey $ s ^. simulatorPeerPrivKey)
      serverPPeer =
        buildPeer
          ( Just $ pubkeystr ss,
            ss ^. simulatorPeerIPAddress,
            30303
          )
      clientPPeer =
        buildPeer
          ( Just $ pubkeystr cs,
            ss ^. simulatorPeerIPAddress,
            30303
          )
  let rServer = runEthServerConduit
                  clientPPeer             
                  (sourceTQueue clientToServerTQueue) 
                  (sinkTQueue serverToClientTQueue)   
                  (sourceTMChan serverSeqSource .| (awaitForever $ yield . modifyServerMsgs))
                  (T.unpack $ "Me: " <> _corePeerName server' <> ", Them: " <> _corePeerName client')
  let rClient = runEthClientConduit         
                  serverPPeer   
                  (sourceTQueue serverToClientTQueue)
                  (sinkTQueue clientToServerTQueue)
                  (sourceTMChan clientSeqSource .| (awaitForever $ yield . modifyClientMsgs))
                  (T.unpack $ "Me: " <> _corePeerName client' <> ", Them: " <> _corePeerName server')
  pure $
    SimulatorP2PConnection
      serverToClientTQueue
      clientToServerTQueue
      server''
      client''
      (runReaderT rServer serverCtx)
      (runReaderT rClient clientCtx)
      serverExceptionTVar
      clientExceptionTVar

createGermophobicSimulatorConnection ::
  (SimulatorPeer, CorePeer) ->
  (SimulatorPeer, CorePeer) ->
  IO SimulatorP2PConnection
createGermophobicSimulatorConnection server'' client'' = do
  let server' = snd server''
      client' = snd client''
  serverToClientTQueue <- newTQueueIO
  clientToServerTQueue <- newTQueueIO
  clientSeqSource <- atomically . dupTMChan $ _corePeerSeqP2pSource client'
  serverCtx <- newIORef (def :: P2PContext)
  clientCtx <- newIORef (def :: P2PContext)
  serverExceptionTVar <- newTVarIO Nothing
  clientExceptionTVar <- newTVarIO Nothing
  let pubkeystr s = BC.unpack $ B16.encode $ B.drop 1 $ exportPublicKey False (derivePublicKey $ s ^. simulatorPeerPrivKey)
      serverPPeer ss =
        buildPeer
          ( Just $ pubkeystr ss,
            ss ^. simulatorPeerIPAddress,
            30303
          )
  let rServer = pure Nothing -- server is germophobic; will not conduct handshake
  let rClient = runEthClientConduit         
                  (serverPPeer $ fst server'')   
                  (sourceTQueue serverToClientTQueue)
                  (sinkTQueue clientToServerTQueue)
                  (sourceTMChan clientSeqSource)
                  (T.unpack $ "Me: " <> _corePeerName client' <> ", Them: " <> _corePeerName server')
  pure $
    SimulatorP2PConnection
      serverToClientTQueue
      clientToServerTQueue
      server''
      client''
      (runReaderT rServer serverCtx)
      (runReaderT rClient clientCtx)
      serverExceptionTVar
      clientExceptionTVar

makeValidators :: [(PrivateKey, a)] -> [(Address, a)]
makeValidators = map (first fromPrivateKey)

mkSignedTx :: PrivateKey -> U.UnsignedTransaction -> Map Text Text -> Transaction
mkSignedTx privKey utx md =
  let Nonce n = U.unsignedTransactionNonce utx
      Gas gl = U.unsignedTransactionGasLimit utx
      Wei gp = U.unsignedTransactionGasPrice utx
      Wei val = U.unsignedTransactionValue utx
      (r', s', v') = getSigVals . signMsg privKey $ U.rlpHash utx
   in if isJust $ U.unsignedTransactionTo utx
        then -- then let Code c = U.unsignedTransactionInitOrData utx

          let c = case U.unsignedTransactionInitOrData utx of
                Code c' -> c'
                _ -> error "mkSignedTx: impossible"
           in MessageTX
                { transactionNonce = fromIntegral n,
                  transactionGasPrice = fromIntegral gp,
                  transactionGasLimit = fromIntegral gl,
                  transactionTo = fromJust $ U.unsignedTransactionTo utx,
                  transactionValue = fromIntegral val,
                  transactionData = c,
                  transactionChainId = Nothing,
                  transactionR = fromIntegral r',
                  transactionS = fromIntegral s',
                  transactionV = v',
                  transactionMetadata = Just $ M.singleton "VM" "SolidVM" <> md
                }
        else
          ContractCreationTX
            { transactionNonce = fromIntegral n,
              transactionGasPrice = fromIntegral gp,
              transactionGasLimit = fromIntegral gl,
              transactionValue = fromIntegral val,
              transactionInit = U.unsignedTransactionInitOrData utx,
              transactionChainId = Nothing,
              transactionR = fromIntegral r',
              transactionS = fromIntegral s',
              transactionV = v',
              transactionMetadata = Just $ M.singleton "VM" "SolidVM" <> md
            }

runSimulatorConnection ::
  SimulatorP2PConnection ->
  IO ()
runSimulatorConnection connection = do
  let rServer = do
        let (s,c) :: (SimulatorPeer, CorePeer) = connection ^. serverSimulatorPeer
        mpdb <- _simulatorContextPeerMap <$> readTVarIO (_simulatorPeerContext s)
        mEx <- runMonad (flip runReaderT mpdb . flip runReaderT s) c $ connection ^. server
        atomically $ writeTVar (connection ^. serverException) mEx
      rClient = do
        let (s,c) :: (SimulatorPeer, CorePeer) = connection ^. clientSimulatorPeer
        mpdb <- _simulatorContextPeerMap <$> readTVarIO (_simulatorPeerContext s)
        mEx <- runMonad (flip runReaderT mpdb . flip runReaderT s) c $ connection ^. client
        atomically $ writeTVar (connection ^. clientException) mEx
  concurrently_ rServer rClient

hoistSimulator :: SimulatorPeer -> (forall a. SimulatorM a -> BaseM a)
hoistSimulator s f = do
  mpdb <- fmap _simulatorContextPeerMap . atomically . readTVar $ _simulatorPeerContext s
  runReaderT (runReaderT f s) mpdb

runSimulatorNode :: SimulatorPeer -> CorePeer -> IO ()
runSimulatorNode s c = runNode (hoistSimulator s) c

createSimulatorNode :: String -> Text -> Validator -> Host -> TCPPort -> UDPPort -> [Host] -> TVar Internet -> ReaderT NetworkManager IO (SimulatorPeer, CorePeer)
createSimulatorNode network' nodeLabel identity ipAddr tcpPort udpPort bootNodes inet = do
  certs <- asks _initialCerts
  vals <- asks _initialValidators
  pKey <- liftIO $ newPrivateKey
  liftIO $ createSimulatorPeerAndCorePeer network' pKey identity vals certs inet nodeLabel ipAddr tcpPort udpPort bootNodes True

addSimulatorNode :: String -> Text -> Validator -> Host -> TCPPort -> UDPPort -> [Host] -> ReaderT NetworkManager IO Bool
addSimulatorNode network' nodeLabel identity ipAddr tcpPort udpPort bootNodes = do
  mgr <- ask
  inet <- _internet <$> readTVarIO (mgr ^. network)
  node <- createSimulatorNode network' nodeLabel identity ipAddr tcpPort udpPort bootNodes inet
  didCreate <- liftIO . atomically $ do
    net <- readTVar $ mgr ^. network
    case M.lookup nodeLabel $ net ^. nodes of
      Nothing -> do
        writeTVar (mgr ^. network) $ net & nodes . at nodeLabel ?~ node
        pure True
      _ -> pure False
  when didCreate . liftIO $ do
    a <- async $ uncurry runSimulatorNode node
    atomically $ modifyTVar (mgr ^. threads) $ nodeThreads . at nodeLabel ?~ a
  pure didCreate

removeSimulatorNode :: Text -> ReaderT NetworkManager IO Bool
removeSimulatorNode nodeLabel = do
  mgr <- ask
  mAsync <- liftIO . atomically $ do
    modifyTVar (mgr ^. network) $ nodes . at nodeLabel .~ Nothing
    ma <- (^. nodeThreads . at nodeLabel) <$> readTVar (mgr ^. threads)
    modifyTVar (mgr ^. threads) $ nodeThreads . at nodeLabel .~ Nothing
    pure ma
  liftIO $ traverse_ cancel mAsync
  pure $ isJust mAsync

addSimulatorConnection :: Text -> Text -> ReaderT NetworkManager IO Bool
addSimulatorConnection serverLabel clientLabel = do
  mgr <- ask
  mPeers <- liftIO . atomically $ do
    net <- readTVar $ mgr ^. network
    case ( M.lookup serverLabel $ net ^. nodes,
           M.lookup clientLabel $ net ^. nodes,
           M.lookup (serverLabel, clientLabel) $ net ^. connections
         ) of
      (Just server', Just client', Nothing) -> pure $ Just (server', client')
      _ -> pure Nothing
  case mPeers of
    Nothing -> pure False
    Just (server', client') ->
      liftIO $ do
        connection <- createSimulatorConnection server' client'
        a <- async $ runSimulatorConnection connection
        atomically $ modifyTVar (mgr ^. threads) $ connectionThreads . at (serverLabel, clientLabel) ?~ a
        pure True

removeSimulatorConnection :: Text -> Text -> ReaderT NetworkManager IO Bool
removeSimulatorConnection serverLabel clientLabel = do
  mgr <- ask
  mAsync <- liftIO . atomically $ do
    modifyTVar (mgr ^. network) $ connections . at (serverLabel, clientLabel) .~ Nothing
    ma <- (^. connectionThreads . at (serverLabel, clientLabel)) <$> readTVar (mgr ^. threads)
    modifyTVar (mgr ^. threads) $ connectionThreads . at (serverLabel, clientLabel) .~ Nothing
    pure ma
  liftIO $ traverse_ cancel mAsync
  pure $ isJust mAsync

selfSignCert :: PrivateKey -> Validator -> IO X509Certificate
selfSignCert pk (Validator c) = flip runReaderT pk $ do
  let iss = Issuer (T.unpack c) "" (Just "") Nothing
      sub = Subject (T.unpack c) "" (Just "") Nothing (derivePublicKey pk)
  makeSignedCert Nothing Nothing iss sub

runNetwork :: [(Text, (Validator, Host, TCPPort, UDPPort))] -> (forall a. [a] -> [a]) -> IO NetworkManager
runNetwork nodesList validatorsFilter = do
  privKeys <- traverse (const newPrivateKey) nodesList
  let identities = (\(_, (c, _, _, _)) -> c) <$> nodesList
      privAndIds = zip privKeys identities
      validatorsPrivKeys = validatorsFilter privAndIds
      validators' = makeValidators validatorsPrivKeys
  certs <- traverse (uncurry selfSignCert) privAndIds
  inet <- newTVarIO preAlGoreInternet
  let bootNodes = (\(_, (_, i, _, _)) -> i) <$> nodesList
  peers <- traverse (\(p, (n, (c, i, t, u))) -> createSimulatorPeerAndCorePeer "simulator" p c validators' certs inet n i t u bootNodes True) $ zip privKeys nodesList
  let nodesMap = M.fromList $ zip (fst <$> nodesList) peers
      network' = Network nodesMap M.empty inet
  nodeThreads' <- for nodesMap $ async . uncurry runSimulatorNode
  let threadPool = ThreadPool nodeThreads' M.empty
  networkTVar <- newTVarIO network'
  threadsTVar <- newTVarIO threadPool
  pure $ NetworkManager threadsTVar networkTVar certs validators'

runNetworkWithStaticConnections :: [(Text, Host, Validator)] -> [(Text, Text)] -> (forall a. [a] -> [a]) -> IO (Either Text NetworkManager)
runNetworkWithStaticConnections nodesList connectionsList validatorsFilter = do
  privKeys <- traverse (const newPrivateKey) nodesList
  let identities = (\(_, _, c) -> c) <$> nodesList
      privAndIds = zip privKeys identities
      validatorsPrivKeys = validatorsFilter privAndIds
      validators' = makeValidators validatorsPrivKeys
  certs <- traverse (uncurry selfSignCert) privAndIds
  inet <- newTVarIO preAlGoreInternet
  peers <- traverse (\(p, (n, i, c)) -> createSimulatorPeerAndCorePeer "simulator" p c validators' certs inet n i (TCPPort 30303) (UDPPort 30303) [] True) $ zip privKeys nodesList
  let nodesMap = M.fromList $ zip ((\(a, _, _) -> a) <$> nodesList) peers
  eConnections <- runExceptT . for connectionsList $ \(server', client') -> do
    serverPeer <- maybeToExceptT ("Couldn't find server " <> server') . MaybeT . pure $ M.lookup server' nodesMap
    clientPeer <- maybeToExceptT ("Couldn't find client " <> client') . MaybeT . pure $ M.lookup client' nodesMap
    liftIO $ createSimulatorConnection serverPeer clientPeer
  for eConnections $ \connections' -> do
    let connectionsMap = M.fromList $ zip connectionsList connections'
        network' = Network nodesMap connectionsMap inet
    nodeThreads' <- for nodesMap $ \(s,c) -> async $ runNodeWithoutP2P (hoistSimulator s) c
    connectionThreads' <- for connectionsMap $ async . runSimulatorConnection
    let threadPool = ThreadPool nodeThreads' connectionThreads'
    networkTVar <- newTVarIO network'
    threadsTVar <- newTVarIO threadPool
    pure $ NetworkManager threadsTVar networkTVar certs validators'

runNetworkOld :: [(SimulatorPeer, CorePeer)] -> [SimulatorP2PConnection] -> IO ()
runNetworkOld nodes' connections' =
  concurrently_
    (mapConcurrently (uncurry runSimulatorNode) nodes')
    (mapConcurrently runSimulatorConnection connections')