{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE TypeOperators #-}

module Strato.Lite.Base where

import BlockApps.Logging
import BlockApps.X509.Certificate as X509
import Blockchain.Context
import Blockchain.Data.Block
import Blockchain.Data.BlockHeader
import Blockchain.Data.BlockSummary
import qualified Blockchain.Data.DataDefs as DataDefs
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.DB.ChainDB
import Blockchain.DB.CodeDB
import Blockchain.Model.SyncState
import Blockchain.Model.WrappedBlock
import qualified Blockchain.Sequencer.DB.DependentBlockDB as DBDB
import Blockchain.Strato.Discovery.ContextLite (MonadDiscovery)
import Blockchain.Strato.Discovery.Data.Peer
import Blockchain.Strato.Indexer.IContext (API (..), P2P (..))
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Host
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Secp256k1
import Blockchain.Strato.StateDiff
import Blockchain.SyncDB
import Conduit
import Control.Monad.Catch (MonadCatch)
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Core.API
import Crypto.Types.PubKey.ECC
import qualified Data.ByteString.Char8 as BC
import qualified Data.NibbleString as N
import Data.Text (Text)
import Prelude hiding (round)
import Prometheus

loggingFunc :: LoggingT m a -> m a
loggingFunc = runLoggingT

type BaseM = ResourceT (LoggingT IO)

newtype SlipstreamCommands = SlipstreamCommands { getSlipstreamCommands :: [Text] }

type MonadBase m = ( MonadFail m
                   , MonadMonitor m
                   , MonadCatch m
                   , MonadUnliftIO m
                   , MonadLogger m
                   , MonadResource m
                   , HasVault m
                   , RunsClient m
                   , RunsServer m (LoggingT IO)
                   , MonadDiscovery m
                   , (Keccak256 `A.Alters` DBDB.DependentBlockEntry) m
                   , (Address `A.Alters` X509CertInfoState) m
                   , (Keccak256 `A.Alters` OutputBlock) m
                   -- , (Keccak256 `A.Alters` BlockHeader) m
                   , A.Selectable (Host, UDPPort, BC.ByteString) Point m
                   , A.Selectable Host PPeer m
                   , A.Replaceable Host PPeer m
                   , (Host `A.Alters` PPeer) m
                   , A.Selectable Point ClosestPeers m
                   , A.Selectable Keccak256 [DataDefs.TransactionResult] m
                   , Mod.Accessible TCPPort m
                   , Mod.Accessible UDPPort m
                   , Mod.Accessible PublicKey m
                   , Mod.Accessible ActivePeers m
                   , Mod.Accessible AvailablePeers m
                   , Mod.Accessible BondedPeers m
                   , Mod.Accessible BondedPeersForUDP m
                   , Mod.Accessible TransactionCount m
                   , Mod.Accessible UnbondedPeersForUDP m
                   , ((Host, TCPPort) `A.Alters` ActivityState) m
                   , A.Replaceable (Host, TCPPort) ActivityState m
                   , A.Replaceable PPeer PeerUdpDisable m
                   , A.Replaceable Text PPeer m
                   , A.Replaceable PPeer TcpEnableTime m
                   , A.Replaceable PPeer UdpEnableTime m
                   , A.Replaceable PPeer PeerDisable m
                   , A.Replaceable PPeer Text m
                   , m `Mod.Yields` DataDefs.TransactionResult
                   , m `Mod.Outputs` StateDiff
                   , m `Mod.Outputs` SlipstreamCommands
                   , (Keccak256 `A.Alters` API OutputTx) m
                   , (Keccak256 `A.Alters` API OutputBlock) m
                   , (Keccak256 `A.Alters` P2P OutputBlock) m
                   , Mod.Modifiable (P2P BestBlock) m
                   , Mod.Modifiable WorldBestBlock m
                   , Mod.Modifiable BestBlock m
                   , Mod.Modifiable BestSequencedBlock m
                   , Mod.Modifiable SyncStatus m
                   , A.Selectable Integer (Canonical BlockHeader) m
                   , A.Replaceable Integer (Canonical BlockHeader) m
                   , MonadBaseVM m
                   , MonadBaseAPI m
                   )

type MonadBaseVM m = ( Mod.Modifiable BlockHashRoot m
                     , Mod.Modifiable GenesisRoot m
                     , Mod.Modifiable BestBlockRoot m
                     , (MP.StateRoot `A.Alters` MP.NodeData) m
                     , (Keccak256 `A.Alters` DBCode) m
                     , (N.NibbleString `A.Alters` N.NibbleString) m
                     , (Keccak256 `A.Alters` BlockSummary) m
                     , Mod.Accessible (Maybe WorldBestBlock) m
                     )

type MonadBaseAPI m = ( GetLastBlocks m
                      , GetLastTransactions m
                      -- , Mod.Accessible [DataDefs.RawTransaction] m
                      -- , A.Selectable AccountsFilterParams [DataDefs.AddressStateRef] m
                      -- , A.Selectable BlocksFilterParams [Block] m
                      -- , A.Selectable StorageFilterParams [StorageAddress] m
                      , A.Selectable TxsFilterParams [DataDefs.RawTransaction] m
                      , A.Selectable Keccak256 [DataDefs.TransactionResult] m
                      , Mod.Accessible TransactionCount m
                      , HasSyncDB m
                      )