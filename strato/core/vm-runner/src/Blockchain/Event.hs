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

import BlockApps.X509.Certificate
import Blockchain.Blockstanbul (PreprepareDecision(..))
import Blockchain.DB.MemAddressStateDB
import Blockchain.Data.Block (Block(..))
import Blockchain.Data.ChainInfo
import Blockchain.Data.DataDefs
import Blockchain.Data.ExecResults
import Blockchain.Database.MerklePatricia.NodeData (NodeData)
import Blockchain.Data.TXOrigin
import Blockchain.Sequencer.Event
import Blockchain.Strato.Indexer.Model (IndexEvent (..))
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Class (DummyCertRevocation(..))
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.StateRoot
import Blockchain.Strato.Model.Validator
import Blockchain.Strato.Model.Address
import Blockchain.Strato.StateDiff
import Blockchain.Stream.Action (Action)
import qualified Data.ByteString as B
import qualified Data.DList as DL
import Data.Map (Map)
import Data.Text (Text)

type VmInEvent = VmEvent

data VmInEventBatch = InBatch
  { rpcCommands :: [JsonRpcCommand],
    txPairs :: [(Timestamp, OutputTx)],
    tLen :: {-# UNPACK #-} !Int,
    blocksAndNewChains :: [Either OutputGenesis OutputBlock],
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
  VmGenesis og -> b {blocksAndNewChains = (Left og) : blocksAndNewChains b}
  VmJsonRpcCommand j -> b {rpcCommands = j : rpcCommands b}
  VmTx ts t -> b {txPairs = (ts, t) : txPairs b, tLen = tLen b + 1}
  VmBlock ob -> b {blocksAndNewChains = (Right ob) : blocksAndNewChains b, bLen = bLen b + 1}
  VmCreateBlockCommand -> b {createBlock = True}
  VmPrivateTx otx -> b {privateTxs = otx : privateTxs b}
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
  | CertRegistrationMismatch (BlockDelta ([X509Certificate],[DummyCertRevocation]))
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
  = OutAction Action
  | OutBlock OutputBlock
  | OutIndexEvent IndexEvent
  | OutToStateDiff Word256 ChainInfo Keccak256 Text Text
  | OutStateDiff StateDiff
  | OutLog LogDB
  | OutEvent [EventDB]
  | OutTXR TransactionResult
  | OutASM (Map Account AddressStateModification)
  | OutJSONRPC String B.ByteString
  | OutBlockVerificationFailure [BlockVerificationFailure]
  | OutGetMPNodes [StateRoot]
  | OutMPNodesResponse TXOrigin [NodeData]
  | OutPreprepareResponse PreprepareDecision

data VmOutEventBatch = OutBatch
  { outActions :: DL.DList Action,
    outExecResults :: DL.DList ExecResults,
    outBlocks :: DL.DList OutputBlock,
    outIndexEvents :: DL.DList IndexEvent,
    outToStateDiffs :: DL.DList (Word256, ChainInfo, Keccak256, Text, Text),
    outStateDiffs :: DL.DList StateDiff,
    outLogs :: DL.DList LogDB,
    outEvents :: DL.DList EventDB,
    outTXRs :: DL.DList TransactionResult,
    outASMs :: DL.DList (Map Account AddressStateModification),
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
    DL.empty
    DL.empty
    []
    DL.empty
    DL.empty
    DL.empty

insertOutBatch :: VmOutEvent -> VmOutEventBatch -> VmOutEventBatch
insertOutBatch e b = case e of
  OutAction a -> b {outActions = outActions b `DL.snoc` a}
  OutBlock a -> b {outBlocks = outBlocks b `DL.snoc` a}
  OutIndexEvent a -> b {outIndexEvents = outIndexEvents b `DL.snoc` a}
  OutToStateDiff v w x y z -> b {outToStateDiffs = outToStateDiffs b `DL.snoc` (v, w, x, y, z)}
  OutStateDiff a -> b {outStateDiffs = outStateDiffs b `DL.snoc` a}
  OutLog a -> b {outLogs = outLogs b `DL.snoc` a}
  OutEvent a -> b {outEvents = outEvents b `DL.append` DL.fromList a}
  OutTXR a -> b {outTXRs = outTXRs b `DL.snoc` a}
  OutASM a -> b {outASMs = outASMs b `DL.snoc` a}
  OutJSONRPC x y -> b {outJSONRPCs = outJSONRPCs b `DL.snoc` (x, y)}
  OutBlockVerificationFailure bvf -> b {outBlockVerificationFailure = bvf}
  OutGetMPNodes srs -> b {outGetMPNodes = outGetMPNodes b `DL.snoc` srs}
  OutMPNodesResponse o nds -> b {outMPNodesResponses = outMPNodesResponses b `DL.snoc` (o, nds)}
  OutPreprepareResponse p -> b {outPreprepareResponses = outPreprepareResponses b `DL.snoc` p}
