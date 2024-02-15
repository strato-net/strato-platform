{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}

module Executable.StratoP2P where

import           Control.Concurrent.Async.Lifted.Safe(Concurrently(..),runConcurrently)
import           Control.Exception hiding (catch)
import           Control.Exception.Lifted (catch)
import           Control.Monad.Change.Alter
import           Control.Monad.Change.Modify
import           Control.Monad.Trans.Reader
import           Control.Monad.Trans.Resource
import           Data.ByteString
import           Data.Foldable            (asum)
import qualified Data.Text as T
import           BlockApps.Logging as BL
import           BlockApps.X509.Certificate
import           Blockchain.Blockstanbul.Messages
import           Blockchain.Data.Block
import           Blockchain.Data.DataDefs
import           Blockchain.Data.Enode
import           Blockchain.Sequencer.Event
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.ChainMember
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.Strato.Model.Secp256k1
import           Blockchain.Strato.Discovery.Data.Peer
import           Blockchain.Context
import           Crypto.Types.PubKey.ECC
import           Executable.StratoP2PClient
import           Executable.StratoP2PLoopback
import           Executable.StratoP2PServer
import           Network.Haskoin.Crypto.BigWord

raceAll :: [LoggingT IO a]
        -> LoggingT IO a
raceAll = runConcurrently . asum . Prelude.map Concurrently

stratoP2P :: ( HasVault n
             , MonadLogger n
             , MonadResource n
             , MonadUnliftIO n
             , Stacks Block n
             , Outputs n [IngestEvent]
             , Accessible [BlockData] n
             , Accessible ActionTimestamp n
             , Accessible RemainingBlockHeaders n
             , Accessible PeerAddress n
             , Accessible MaxReturnedHeaders n
             , Accessible ConnectionTimeout n
             , Accessible GenesisBlockHash n
             , Accessible BestBlockNumber n
             , Accessible AvailablePeers n
             , Accessible BondedPeers n
             , Accessible PublicKey n
             , Modifiable [BlockData] n
             , Modifiable ActionTimestamp n
             , Modifiable RemainingBlockHeaders n
             , Modifiable PeerAddress n
             , Modifiable BestBlock n
             , Modifiable WorldBestBlock n
             , Selectable (IPAsText, UDPPort, ByteString) Point n
             , Selectable Word256 ChainMemberRSet n
             , Selectable Word256 ChainInfo n
             , Selectable Integer (Canonical BlockData) n
             , Selectable Keccak256 (Private (Word256, OutputTx)) n
             , Selectable Keccak256 ChainTxsInBlock n
             , Selectable Address X509CertInfoState n
             , Selectable IPAsText PPeer n
             , Selectable Point PPeer n
             , Selectable ChainMemberParsedSet [ChainMemberParsedSet] n
             , Selectable ChainMemberParsedSet TrueOrgNameChains n
             , Selectable ChainMemberParsedSet FalseOrgNameChains n
             , Selectable ChainMemberParsedSet X509CertInfoState n
             , Selectable ChainMemberParsedSet IsValidator n
             , Replaceable (IPAsText, Point) PeerBondingState n
             , Replaceable PPeer TcpEnableTime n
             , Replaceable PPeer UdpEnableTime n
             , Replaceable PPeer PeerDisable n
             , Replaceable PPeer T.Text n
             , Alters (T.Text, Keccak256) (Proxy (Outbound WireMessage)) n
             , Alters (IPAsText, TCPPort) ActivityState n
             , Alters Keccak256 (Proxy (Inbound WireMessage)) n
             , Alters Keccak256 BlockData n
             , Alters Keccak256 OutputBlock n
             , RunsServer n (LoggingT IO)
             , Accessible AvailablePeers (ReaderT Config (ResourceT (LoggingT IO)))
             , Accessible BondedPeers (ReaderT Config (ResourceT (LoggingT IO)))
             , Accessible BondedPeers (LoggingT IO)
             , Replaceable (IPAsText, Point) PeerBondingState (ReaderT Config (ResourceT (LoggingT IO)))
             , Replaceable PPeer TcpEnableTime (ReaderT Config (ResourceT (LoggingT IO)))
             , Replaceable PPeer UdpEnableTime (ReaderT Config (ResourceT (LoggingT IO)))
             , Replaceable PPeer PeerDisable (ReaderT Config (ResourceT (LoggingT IO)))
             , Replaceable PPeer T.Text (ReaderT Config (ResourceT (LoggingT IO)))
             , Alters (IPAsText, TCPPort) ActivityState (ReaderT Config (ResourceT (LoggingT IO)))
             )
          => PeerRunner n (LoggingT IO) () -> LoggingT IO ()
stratoP2P runner =
  raceAll [ stratoP2PLoopback runner `catch` (\(e :: SomeException) -> $logErrorS "stratoP2PLoopback ERROR" . T.pack $ show e)
          , stratoP2PClient          `catch` (\(e :: SomeException) -> $logErrorS "stratoP2PClient ERROR" . T.pack $ show e)
          , stratoP2PServer   runner `catch` (\(e :: SomeException) -> $logErrorS "stratoP2PServer ERROR" . T.pack $ show e)
          ]
