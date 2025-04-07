{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE DeriveGeneric #-}

module Blockchain.Sequencer.Event (
  ShowConstructor,
  showConstructor,
  IngestEvent(..),
  VmEvent(..),
  P2pEvent(..),
  Timestamp,
  SeqLoopEvent(..),
  JsonRpcCommand(..),
  ) where

import qualified Blockchain.Blockstanbul as PBFT
import qualified Blockchain.Data.Block as BDB
import qualified Blockchain.Data.TXOrigin as TO
import Blockchain.Database.MerklePatricia.NodeData (NodeData)
import Blockchain.Model.WrappedBlock (OutputBlock(..), OutputTx(..), IngestBlock(..), IngestTx(..))
import qualified Blockchain.Strato.Model.Address as A
import Blockchain.Strato.Model.ChainMember
import Blockchain.Strato.Model.Keccak256 (Keccak256)
import Blockchain.Strato.Model.MicroTime
import Blockchain.Strato.Model.StateRoot
import Blockchain.Strato.Model.Address
import Data.Binary
import qualified Data.ByteString as BS
import Data.Data
import Data.List (intercalate)
import qualified GHC.Generics as GHCG
import Text.Format

data SeqLoopEvent
  = TimerFire PBFT.RoundNumber
  | UnseqEvents [IngestEvent]
  deriving (Eq, Show, GHCG.Generic)

instance Format SeqLoopEvent where
  format (TimerFire rn) = "TimerFire " ++ format rn
  format (UnseqEvents ev) = "UnseqEvents " ++ format ev

class ShowConstructor a where
  showConstructor :: a -> String

data IngestEvent
  = IETx Timestamp IngestTx
  | IEBlock IngestBlock
  | IEBlockstanbul PBFT.WireMessage
  | IEForcedConfigChange PBFT.ForcedConfigChange
  | IEValidatorBehavior PBFT.ForcedValidatorChange
  | IEDeleteDepBlock Keccak256
  | IEGetMPNodes [StateRoot]
  | IEGetMPNodesRequest TO.TXOrigin [StateRoot]
  | IEMPNodesResponse TO.TXOrigin [NodeData]
  | IEMPNodesReceived [NodeData]
  | IEPreprepareResponse PBFT.PreprepareDecision
  deriving (Eq, Show, GHCG.Generic)

instance Format IngestEvent where
  format (IETx ts o) = show ts ++ " " ++ format o
  format (IEBlock o) = format o
  format (IEBlockstanbul o) = format o
  format (IEForcedConfigChange o) = format o
  format (IEValidatorBehavior o) = show o
  format (IEDeleteDepBlock o) = show o
  format (IEGetMPNodes o) = format o
  format (IEGetMPNodesRequest o s) = format o ++ "requested: " ++ format s
  format (IEMPNodesResponse o n) = "Response to " ++ format o ++ ": " ++ show n
  format (IEMPNodesReceived o) = show o
  format (IEPreprepareResponse d) = format d

type Timestamp = Microtime

data JsonRpcCommand
  = JRCGetBalance {jrcAddress :: A.Address, jrcId :: String, jrcBlockString :: String}
  | JRCGetCode {jrcAddress :: A.Address, jrcId :: String, jrcBlockString :: String}
  | JRCGetTransactionCount {jrcAddress :: A.Address, jrcId :: String, jrcBlockString :: String}
  | JRCGetStorageAt {jrcAddress :: A.Address, jrcKey :: BS.ByteString, jrcId :: String, jrcBlockString :: String}
  | JRCCall {jrcCode :: BS.ByteString, jrcId :: String, jrcBlockString :: String}
  deriving (Eq, Read, Show, GHCG.Generic, Data)

data P2pEvent
  = P2pTx OutputTx
  | P2pBlock OutputBlock
  | P2pBlockstanbul PBFT.WireMessage
  | -- Ask and push for inclusive ranges of blocks
    P2pAskForBlocks {askStart :: Integer, askEnd :: Integer, askPeer :: ChainMemberParsedSet}
  | P2pPushBlocks {pushStart :: Integer, pushEnd :: Integer, pushPeer :: ChainMemberParsedSet}
  | P2pGetMPNodes [StateRoot]
  | P2pMPNodesResponse TO.TXOrigin [NodeData]
  deriving (Eq, Show, GHCG.Generic)

instance Format P2pEvent where
  format (P2pTx o) = format o
  format (P2pBlock o) = format o
  format (P2pBlockstanbul o) = format o
  format (P2pGetMPNodes srs) = "[" ++ (intercalate "," $ map format srs) ++ "]"
  format (P2pMPNodesResponse o nds) = "Response to " ++ show o ++ ": [" ++ (intercalate "," $ map show nds) ++ "]"
  format x = show x

instance ShowConstructor P2pEvent where
  showConstructor P2pTx{} = "P2pTx"
  showConstructor P2pBlock{} = "P2pBlock"
  showConstructor P2pBlockstanbul{} = "P2pBlockstanbul"
  showConstructor P2pAskForBlocks{} = "P2pAskForBlocks"
  showConstructor P2pPushBlocks{} = "P2pPushBlocks"
  showConstructor P2pGetMPNodes{} = "P2pGetMPNodes"
  showConstructor P2pMPNodesResponse{} = "P2pMPNodesResponse"

data VmEvent
  = VmTx Timestamp OutputTx
  | VmBlock OutputBlock
  | VmJsonRpcCommand JsonRpcCommand
  | VmCreateBlockCommand
  | VmGetMPNodesRequest TO.TXOrigin [StateRoot]
  | VmMPNodesReceived [NodeData]
  | VmRunPreprepare BDB.Block
  | VmSelfAddress Address
  deriving (Eq, Show, GHCG.Generic)

instance Format VmEvent where
  format (VmTx ts o) = show ts ++ " " ++ format o
  format (VmBlock o) = format o
  format (VmGetMPNodesRequest o srs) = show o ++ " requested: " ++ format srs
  format (VmMPNodesReceived nds) = show nds
  format x = show x

instance ShowConstructor VmEvent where
  showConstructor VmTx{} = "VmTx"
  showConstructor VmBlock{} = "VmBlock"
  showConstructor VmJsonRpcCommand{} = "VmJsonRpcCommand"
  showConstructor VmCreateBlockCommand{} = "VmCreateBlockCommand"
  showConstructor VmGetMPNodesRequest{} = "VmGetMPNodesRequest"
  showConstructor VmMPNodesReceived{} = "VmMPNodesReceived"
  showConstructor VmRunPreprepare{} = "VmRunPreprepare"
  showConstructor VmSelfAddress{} = "VmSelfAddress"

instance Binary IngestEvent

instance Binary JsonRpcCommand

instance Binary P2pEvent

instance Binary VmEvent
