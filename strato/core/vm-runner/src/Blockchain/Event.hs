{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.Event
  ( VmInEvent,
    VmInEventBatch (..),
    newInBatch,
    insertInBatch,
    BlockDelta(..),
    BlockVerificationFailureDetails(..),
    BlockVerificationFailure(..),
    VmOutEvent (..),
    VmOutEventBatch (..),
    newOutBatch,
    insertOutBatch,
  )
where

import Blockchain.Blockstanbul (PreprepareDecision(..))
import Blockchain.DB.MemAddressStateDB
import Blockchain.Data.Block (Block(..))
import Blockchain.Data.DataDefs
import Blockchain.Data.ExecResults
import Blockchain.Database.MerklePatricia.NodeData (NodeData)
import Blockchain.Data.TXOrigin
import Blockchain.Model.WrappedBlock
import Blockchain.Sequencer.Event
import Blockchain.Strato.Indexer.Model (IndexEvent (..))
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.StateRoot
import Blockchain.Strato.Model.Validator
import Blockchain.Strato.Model.Address
import Blockchain.Strato.StateDiff
import Blockchain.Stream.VMEvent
import qualified Data.ByteString as B
import qualified Data.DList as DL
import Data.Map (Map)

type VmInEvent = VmEvent

data VmInEventBatch = InBatch
  { rpcCommands :: [JsonRpcCommand],
    txPairs :: [(Timestamp, OutputTx)],
    tLen :: {-# UNPACK #-} !Int,
    blocks :: [OutputBlock],
    bLen :: {-# UNPACK #-} !Int,
    createBlock :: !Bool,
    privateTxs :: [OutputTx],
    mpNodesReqs :: [(TXOrigin, [StateRoot])],
    mpNodesResps :: [[NodeData]],
    preprepareBlock :: Maybe Block,
    selfAddress :: Maybe Address
  }

newInBatch :: VmInEventBatch
newInBatch = InBatch [] [] 0 [] 0 False [] [] [] Nothing Nothing

insertInBatch :: VmInEvent -> VmInEventBatch -> VmInEventBatch
insertInBatch e b = case e of
  VmJsonRpcCommand j -> b {rpcCommands = j : rpcCommands b}
  VmTx ts t -> b {txPairs = (ts, t) : txPairs b, tLen = tLen b + 1}
  VmBlock ob -> b {blocks = ob : blocks b, bLen = bLen b + 1}
  VmCreateBlockCommand -> b {createBlock = True}
  VmGetMPNodesRequest o srs -> b {mpNodesReqs = (o, srs) : mpNodesReqs b}
  VmMPNodesReceived nds -> b {mpNodesResps = nds : mpNodesResps b}
  VmRunPreprepare b' -> b {preprepareBlock = Just b'}
  VmSelfAddress sa -> b {selfAddress = Just sa}
  
data BlockDelta a = BlockDelta 
  { _inBlock :: a
  , _derived :: a
  }
  deriving (Eq, Show)

data BlockVerificationFailureDetails
  = StateRootMismatch        (BlockDelta StateRoot)
  | ValidatorMismatch        (BlockDelta ([Validator],[Validator]))
  | VersionMismatch          (BlockDelta Int)
  | UnclesMismatch           (BlockDelta Keccak256)
  | UnexpectedBlockNumber    (BlockDelta Integer)
  deriving (Eq, Show)

data BlockVerificationFailure = BlockVerificationFailure
  { _bvfBlockNumber :: Integer
  , _bvfBlockHash   :: Keccak256
  , _bvfDetails     :: BlockVerificationFailureDetails
  } deriving (Eq, Show)

data VmOutEvent
  = OutVMEvents [VMEvent]
  | OutBlock OutputBlock
  | OutIndexEvent IndexEvent
  | OutStateDiff StateDiff
  | OutLog LogDB
  | OutEvent [EventDB]
  | OutASM (Map Address AddressStateModification)
  | OutJSONRPC String B.ByteString
  | OutBlockVerificationFailure [BlockVerificationFailure]
  | OutGetMPNodes [StateRoot]
  | OutMPNodesResponse TXOrigin [NodeData]
  | OutPreprepareResponse PreprepareDecision

data VmOutEventBatch = OutBatch
  { outVMEvents :: DL.DList [VMEvent],
    outExecResults :: DL.DList ExecResults,
    outBlocks :: DL.DList OutputBlock,
    outIndexEvents :: DL.DList IndexEvent,
    outStateDiffs :: DL.DList StateDiff,
    outLogs :: DL.DList LogDB,
    outEvents :: DL.DList EventDB,
    outASMs :: DL.DList (Map Address AddressStateModification),
    outJSONRPCs :: DL.DList (String, B.ByteString),
    outBlockVerificationFailure :: [BlockVerificationFailure],
    outGetMPNodes :: DL.DList [StateRoot],
    outMPNodesResponses :: DL.DList (TXOrigin, [NodeData]),
    outPreprepareResponses :: DL.DList (PreprepareDecision)
  }

newOutBatch :: VmOutEventBatch
newOutBatch =
  OutBatch
    DL.empty
    DL.empty
    DL.empty
    DL.empty
    DL.empty
    DL.empty
    DL.empty
    DL.empty
    DL.empty
    []
    DL.empty
    DL.empty
    DL.empty

insertOutBatch :: VmOutEvent -> VmOutEventBatch -> VmOutEventBatch
insertOutBatch e b = case e of
  OutVMEvents a -> b {outVMEvents = outVMEvents b `DL.snoc` a}
  OutBlock a -> b {outBlocks = outBlocks b `DL.snoc` a}
  OutIndexEvent a -> b {outIndexEvents = outIndexEvents b `DL.snoc` a}
  OutStateDiff a -> b {outStateDiffs = outStateDiffs b `DL.snoc` a}
  OutLog a -> b {outLogs = outLogs b `DL.snoc` a}
  OutEvent a -> b {outEvents = outEvents b `DL.append` DL.fromList a}
  OutASM a -> b {outASMs = outASMs b `DL.snoc` a}
  OutJSONRPC x y -> b {outJSONRPCs = outJSONRPCs b `DL.snoc` (x, y)}
  OutBlockVerificationFailure bvf -> b {outBlockVerificationFailure = bvf}
  OutGetMPNodes srs -> b {outGetMPNodes = outGetMPNodes b `DL.snoc` srs}
  OutMPNodesResponse o nds -> b {outMPNodesResponses = outMPNodesResponses b `DL.snoc` (o, nds)}
  OutPreprepareResponse p -> b {outPreprepareResponses = outPreprepareResponses b `DL.snoc` p}
