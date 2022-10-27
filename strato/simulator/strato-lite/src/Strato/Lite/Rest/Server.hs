{-# LANGUAGE DataKinds           #-}
{-# LANGUAGE FlexibleContexts    #-}
{-# LANGUAGE LambdaCase          #-}
{-# LANGUAGE NoMonomorphismRestriction #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE QuasiQuotes         #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeOperators       #-}

module Strato.Lite.Rest.Server where

import qualified Control.Concurrent.STM.MonadIO    as CCS
import           Control.Lens
import           Control.Monad.IO.Class
import           Control.Monad.Reader
import           Data.Bifunctor                    (first)
import           Data.Foldable                     (for_, traverse_)
import           Data.Traversable                  (for)
import qualified Data.Map.Strict                   as M
import           Data.Maybe                        (fromMaybe)
import qualified Data.Text                         as T
import           Blockchain.Data.AlternateTransaction as AT hiding (rlpHash)
import           Blockchain.Data.ChainInfo
import           Blockchain.Data.Enode            
import qualified Blockchain.Data.TXOrigin          as Origin
import           Blockchain.Sequencer.Event
import           Strato.Lite.Rest.Api
import           Strato.Lite.Monad
import qualified Blockchain.Strato.Discovery.Data.Peer as DataPeer
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.ChainId
import           Blockchain.Strato.Model.Code
import           Blockchain.Strato.Model.CodePtr   
import           Blockchain.Strato.Model.Gas
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.Strato.Model.MicroTime
import           Blockchain.Strato.Model.Nonce
import           Blockchain.Strato.Model.Wei
import           Servant
import           Text.RawString.QQ
import           UnliftIO                          hiding (Handler)
import           UnliftIO.Concurrent               (threadDelay)

getNodes :: NetworkManager -> Handler ThreadResultMap
getNodes mgr = liftIO . atomically $ do
  ths <- readTVar $ mgr ^. threads
  for (ths ^. nodeThreads) $ \a -> do
    mExp <- pollSTM a
    pure $ fmap (first show) mExp

getConnections :: NetworkManager -> Handler ThreadResultMap
getConnections mgr = liftIO . atomically $ do
  ths <- readTVar $ mgr ^. threads
  let f (s,c) = "(" <> s <> "," <> c <> ")"
  fmap (M.mapKeys f) . for (ths ^. connectionThreads) $ \a -> do
    mExp <- pollSTM a
    pure $ fmap (first show) mExp

getChainInfo :: NetworkManager -> T.Text -> Handler ThreadResultMap
getChainInfo mgr nodeLabel = liftIO . atomically $ do
  ths <- readTVar $ mgr ^. network
  let theNode = fromMaybe (error "Node not found.") $ M.lookup nodeLabel $ ths ^. nodes
  ctxt <- (CCS.readTVarSTM . _p2pTestContext) theNode
  let chainInfo = (Just . Left) $ show $ ctxt ^. chainInfoMap
      res = M.singleton nodeLabel chainInfo
  pure $ res

getEnode :: NetworkManager -> T.Text -> Handler ThreadResultMap
getEnode mgr nodeLabel = do
  mPeer <- liftIO $ fmap (M.lookup nodeLabel . _nodes) . readTVarIO $ mgr ^. network
  let mPeer' = fromMaybe (error "Node not found.") mPeer
      enodeString = showEnode $ fromMaybe (error "Enode not found.") $ (DataPeer.pPeerEnode . _p2pPeerPPeer) mPeer' 
      enodeString' = (Just . Left) enodeString
      res = M.singleton nodeLabel enodeString'
  pure $ res

getAddress :: NetworkManager -> T.Text -> Handler ThreadResultMap
getAddress mgr nodeLabel = liftIO $ atomically $ do
  ths <- readTVar $ mgr ^. network
  let theNode = fromMaybe (error "Node not found.") $ M.lookup nodeLabel $ ths ^. nodes
  ctxt <- (CCS.readTVarSTM . _p2pTestContext) theNode
  let peaKey = (show . fromPrivateKey . _prvKey) ctxt
      res = M.singleton nodeLabel $ (Just . Left) peaKey
  pure $ res

postAddNode :: NetworkManager -> T.Text -> T.Text -> Handler Bool
postAddNode mgr label ip = liftIO $ runReaderT (addNode label (IPAsText ip) (TCPPort 30303) (UDPPort 30303)) mgr

postRemoveNode :: NetworkManager -> T.Text -> Handler Bool
postRemoveNode mgr label = liftIO $ runReaderT (removeNode label) mgr

postAddConnection :: NetworkManager -> T.Text -> T.Text -> Handler Bool
postAddConnection mgr s c = liftIO $ runReaderT (addConnection s c) mgr

postRemoveConnection :: NetworkManager -> T.Text -> T.Text -> Handler Bool
postRemoveConnection mgr s c = liftIO $ runReaderT (removeConnection s c) mgr

postTimeout :: NetworkManager -> Int -> Handler ()
postTimeout mgr rn = do
  let ev = TimerFire $ fromIntegral rn 
  peers <- liftIO $ fmap (M.elems . _nodes) . readTVarIO $ mgr ^. network
  liftIO $ traverse_ (postEvent ev) peers

postTx :: NetworkManager -> T.Text -> PostTxParams -> Handler ()
postTx mgr nodeLabel (PostTxParams tx md) = do
  mPeer <- liftIO $ fmap (M.lookup nodeLabel . _nodes) . readTVarIO $ mgr ^. network
  liftIO . for_ mPeer $ \peer -> do
    ts <- liftIO $ getCurrentMicrotime
    let signedTx = mkSignedTx (peer ^. p2pPeerPrivKey) tx md
        ev = UnseqEvent . IETx ts $ IngestTx Origin.API signedTx
    postEvent ev peer

postBootChain :: NetworkManager -> Handler ()
postBootChain mgr = do
  bootNode <- fmap (M.lookup "Boot" . _nodes) . readTVarIO $ mgr ^. network
  nodeOne <- fmap (M.lookup "Node1" . _nodes) . readTVarIO $ mgr ^. network
  nodeThree <- fmap (M.lookup "Node3" . _nodes) . readTVarIO $ mgr ^. network
  let contractName = "A"
      src = [r|
pragma solidvm 3.2;
contract A {
  event MemberAdded(address addr, string enode);
  constructor () {
  }
  function addMember(address _addr, string _enode) {
    emit MemberAdded(_addr, _enode);
  }
}
|]
      bootNode' = fromMaybe (error "Node not found.") bootNode
      nodeOne' = fromMaybe (error "Node not found.") nodeOne
      nodeThree' = fromMaybe (error "Node not found.") nodeThree
  bootNodeCtxt <- atomically $ (CCS.readTVarSTM . _p2pTestContext) bootNode'
  nodeOneCtxt <- atomically $ (CCS.readTVarSTM . _p2pTestContext) nodeOne'
  nodeThreeCtxt <- atomically $ (CCS.readTVarSTM . _p2pTestContext) nodeThree'
  let bootPrvKey = _prvKey bootNodeCtxt
      onePrvKey = _prvKey nodeOneCtxt
      threePrvKey = _prvKey nodeThreeCtxt
      bootEnode = fromMaybe (error "Enode not found.") $ (DataPeer.pPeerEnode . _p2pPeerPPeer) bootNode' 
      oneEnode = fromMaybe (error "Enode not found.") $ (DataPeer.pPeerEnode . _p2pPeerPPeer) nodeOne'
      threeEnode = fromMaybe (error "Enode not found.") $ (DataPeer.pPeerEnode . _p2pPeerPPeer) nodeThree'
      chainInfo' = ChainInfo
              UnsignedChainInfo { chainLabel     = "My test chain!"
                                , accountInfo    = [ ContractNoStorage (Address 0x100) 1000000000000000000000 (SolidVMCode contractName $ hash src)
                                                   , NonContract (fromPrivateKey bootPrvKey) 1000000000000000000000
                                                   ]
                                , codeInfo       = [CodeInfo "" src $ (Just . T.pack) contractName]
                                , members        = M.fromList [((fromPrivateKey bootPrvKey), bootEnode), ((fromPrivateKey onePrvKey), oneEnode)]
                                , parentChain    = Nothing
                                , creationBlock  = zeroHash
                                , chainNonce     = 123456789
                                , chainMetadata  = M.singleton "VM" "SolidVM"
                                }
              Nothing
      chainId = keccak256ToWord256 $ rlpHash chainInfo'
  liftIO $ flip postEvent bootNode' $ UnseqEvent . IEGenesis $ IngestGenesis Origin.API (chainId, chainInfo')  
  liftIO $ threadDelay 500000
  ts <- liftIO $ getCurrentMicrotime
  let txArgs = "(0x" <> T.pack (formatAddressWithoutColor $ fromPrivateKey threePrvKey) <> ",\"" <> (T.pack . showEnode) threeEnode <> "\")"
      txMd = M.fromList [("funcName","addMember"),("args",txArgs)]
      utx = AT.UnsignedTransaction
          { AT.unsignedTransactionNonce      = Nonce 0
          , AT.unsignedTransactionGasPrice   = Wei 1
          , AT.unsignedTransactionGasLimit   = Gas 1000000000
          , AT.unsignedTransactionTo         = Just $ Address 0x100
          , AT.unsignedTransactionValue      = Wei 0
          , AT.unsignedTransactionInitOrData = Code ""
          , AT.unsignedTransactionChainId    = Just $ ChainId chainId
          }
      tx = mkSignedTx (bootNode' ^. p2pPeerPrivKey) utx txMd
      ietx = IETx ts $ IngestTx Origin.API tx
  liftIO $ flip postEvent bootNode' $ UnseqEvent ietx

stratoLiteRestServer :: NetworkManager -> Server StratoLiteRestAPI
stratoLiteRestServer mgr =
       getNodes mgr
  :<|> getConnections mgr
  :<|> getChainInfo mgr
  :<|> getEnode mgr
  :<|> getAddress mgr
  :<|> postAddNode mgr
  :<|> postRemoveNode mgr
  :<|> postAddConnection mgr
  :<|> postRemoveConnection mgr
  :<|> postTimeout mgr
  :<|> postTx mgr
  :<|> postBootChain mgr

stratoLiteRestApp :: NetworkManager -> Application
stratoLiteRestApp = serve stratoLiteRestAPI . stratoLiteRestServer