{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}

module Executable.StratoP2P where

--import           Control.Concurrent.Async.Lifted.Safe(Concurrently(..),runConcurrently)
import           Control.Exception hiding (catch)
import           Control.Exception.Lifted (catch)
import           Control.Monad.Change.Alter
import           Control.Monad.Change.Modify
--import           Control.Monad.IO.Class
import           Control.Monad.Trans.Resource
import           Control.Monad.Trans.Control
import           Control.Monad.Trans.Reader
import           Control.Monad.Logger
import           Crypto.Types.PubKey.ECC
import           Data.ByteString
--import           Data.Foldable            (asum)
import qualified Data.Text as T
import           UnliftIO.Async (race_)
import           BlockApps.Logging as BL
import           BlockApps.X509.Certificate
import           Blockchain.Blockstanbul.Messages
import           Blockchain.Context
import           Blockchain.Data.Block
import           Blockchain.Data.DataDefs
import           Blockchain.Data.Enode
import           Blockchain.Sequencer.Event
import           Blockchain.Strato.Discovery.Data.Peer
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.ChainMember
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.Strato.Model.Secp256k1
import           Network.Haskoin.Crypto.BigWord
import           Executable.StratoP2PClient
import           Executable.StratoP2PLoopback
import           Executable.StratoP2PServer

--raceAll :: [BL.LoggingT IO a]
--        -> BL.LoggingT IO a
--raceAll :: ( MonadBaseControl IO m
--           )
--        => [BL.LoggingT m a]
--        -> BL.LoggingT m a
--raceAll = runConcurrently . asum . map Concurrently

{-
stratoP2P :: ( MonadP2P n
             , RunsClient n
             , RunsServer n (BL.LoggingT IO)
             )
          => PeerRunner n (BL.LoggingT IO) () -> BL.LoggingT IO ()
stratoP2P runner =
  raceAll [ stratoP2PLoopback runner `catch` (\(e :: SomeException) -> $logErrorS "stratoP2PLoopback ERROR" . T.pack $ show e)
          , stratoP2PClient   runner `catch` (\(e :: SomeException) -> $logErrorS "stratoP2PClient ERROR" . T.pack $ show e)
          , stratoP2PServer   runner `catch` (\(e :: SomeException) -> $logErrorS "stratoP2PServer ERROR" . T.pack $ show e)
          ]
-}

--stratoP2P :: ( MonadP2P n
--             , RunsClient n
--             , RunsServer n (BL.LoggingT IO)
--             )
--          => PeerRunner n (BL.LoggingT IO) () -> BL.LoggingT IO ()
--stratoP2P runner =
stratoP2P :: ( MonadBaseControl IO m
             , MonadResource m
             , MonadLogger m
             , MonadUnliftIO m
             , HasVault (BL.LoggingT m)
             , Accessible [BlockData] (BL.LoggingT m)
             , Accessible ActionTimestamp (BL.LoggingT m)
             , Accessible RemainingBlockHeaders (BL.LoggingT m)
             , Accessible PeerAddress (BL.LoggingT m)
             , Accessible MaxReturnedHeaders (BL.LoggingT m)
             , Accessible ConnectionTimeout (BL.LoggingT m)
             , Accessible GenesisBlockHash (BL.LoggingT m)
             , Accessible BestBlockNumber (BL.LoggingT m)
             , Accessible PublicKey (BL.LoggingT m)
             , Accessible BondedPeers (ReaderT Config (ResourceT (BL.LoggingT m)))
             , Accessible BondedPeers (BL.LoggingT m)
             , Accessible AvailablePeers (ReaderT Config (ResourceT (BL.LoggingT m)))
             , Accessible AvailablePeers (BL.LoggingT m)
             , Alters (T.Text,Keccak256) (Proxy (Outbound Blockchain.Blockstanbul.Messages.WireMessage)) (BL.LoggingT m)
             , Alters (IPAsText,TCPPort) ActivityState (ReaderT Config (ResourceT (BL.LoggingT m)))
             , Alters (IPAsText,TCPPort) ActivityState (BL.LoggingT m)
             , Alters Keccak256 (Proxy (Inbound WireMessage)) (BL.LoggingT m)
             , Alters Keccak256 BlockData (BL.LoggingT m)
             , Alters Keccak256 OutputBlock (BL.LoggingT m)
             , Modifiable ActionTimestamp (BL.LoggingT m)
             , Modifiable RemainingBlockHeaders (BL.LoggingT m)
             , Modifiable [BlockData] (BL.LoggingT m)
             , Modifiable PeerAddress (BL.LoggingT m)
             , Modifiable BestBlock (BL.LoggingT m)
             , Modifiable WorldBestBlock (BL.LoggingT m)
             , Replaceable (IPAsText,Point) PeerBondingState (ReaderT Config (ResourceT (BL.LoggingT m)))
             , Replaceable (IPAsText,Point) PeerBondingState (BL.LoggingT m)
             , Replaceable PPeer TcpEnableTime (ReaderT Config (ResourceT (BL.LoggingT m)))
             , Replaceable PPeer TcpEnableTime (BL.LoggingT m)
             , Replaceable PPeer UdpEnableTime (ReaderT Config (ResourceT (BL.LoggingT m)))
             , Replaceable PPeer UdpEnableTime (BL.LoggingT m)
             , Replaceable PPeer PeerDisable (ReaderT Config (ResourceT (BL.LoggingT m)))
             , Replaceable PPeer PeerDisable (BL.LoggingT m)
             , Replaceable PPeer T.Text (ReaderT Config (ResourceT (BL.LoggingT m)))
             , Replaceable PPeer T.Text (BL.LoggingT m)
             , Selectable (IPAsText,UDPPort,ByteString) Point (BL.LoggingT m)
             , Selectable Word256 ChainMemberRSet (BL.LoggingT m)
             , Selectable Word256 ChainInfo (BL.LoggingT m)
             , Selectable Integer (Canonical BlockData) (BL.LoggingT m)
             , Selectable Keccak256 (Private (Word256,OutputTx)) (BL.LoggingT m)
             , Selectable Keccak256 ChainTxsInBlock (BL.LoggingT m)
             , Selectable Address X509CertInfoState (BL.LoggingT m)
             , Selectable IPAsText PPeer (BL.LoggingT m)
             , Selectable Point PPeer (BL.LoggingT m)
             , Selectable ChainMemberParsedSet [ChainMemberParsedSet] (BL.LoggingT m)
             , Selectable ChainMemberParsedSet TrueOrgNameChains (BL.LoggingT m)
             , Selectable ChainMemberParsedSet FalseOrgNameChains (BL.LoggingT m)
             , Selectable ChainMemberParsedSet X509CertInfoState (BL.LoggingT m)
             , Selectable ChainMemberParsedSet IsValidator (BL.LoggingT m)
             , Stacks Block (BL.LoggingT m)
             , Outputs (BL.LoggingT m) [IngestEvent]
             , RunsClient (ReaderT Config (ResourceT (BL.LoggingT m)))
             , RunsServer (ReaderT Config (ResourceT (BL.LoggingT m))) (BL.LoggingT m)
             )
          => BL.LoggingT m ()
stratoP2P =
  race_ (stratoP2PLoopback `catch` (\(e :: SomeException) -> $logErrorS "stratoP2PLoopback ERROR" . T.pack $ show e))
        ( race_ (stratoP2PClient   `catch` (\(e :: SomeException) -> $logErrorS "stratoP2PClient ERROR" . T.pack $ show e))
                (stratoP2PServer   `catch` (\(e :: SomeException) -> $logErrorS "stratoP2PServer ERROR" . T.pack $ show e))
        )   
     
  --raceAll [ stratoP2PLoopback `catch` (\(e :: SomeException) -> $logErrorS "stratoP2PLoopback ERROR" . T.pack $ show e)
  --        , stratoP2PClient   `catch` (\(e :: SomeException) -> $logErrorS "stratoP2PClient ERROR" . T.pack $ show e)
  --        , stratoP2PServer   `catch` (\(e :: SomeException) -> $logErrorS "stratoP2PServer ERROR" . T.pack $ show e)
  --        ]
