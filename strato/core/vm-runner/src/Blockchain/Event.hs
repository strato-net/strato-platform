{-# LANGUAGE BangPatterns      #-}
{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE TypeOperators     #-}

module Blockchain.Event
  ( VmInEvent
  , VmInEventBatch(..)
  , newInBatch
  , insertInBatch
  , VmOutEvent(..)
  , VmOutEventBatch(..)
  , newOutBatch
  , insertOutBatch
  ) where

import           Blockchain.Data.ChainInfo
import           Blockchain.Data.DataDefs
import           Blockchain.Data.ExecResults
import           Blockchain.DB.MemAddressStateDB
import           Blockchain.Sequencer.Event
import           Blockchain.Strato.Indexer.Model    (IndexEvent (..))
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.ExtendedWord
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.Strato.StateDiff
import           Blockchain.Stream.Action           (Action)
import qualified Data.ByteString                    as B
import qualified Data.DList                         as DL
import           Data.Map                           (Map)

type VmInEvent = VmEvent

data VmInEventBatch = InBatch
  { votesToMake        :: [(Address, Bool, Address)]
  , rpcCommands        :: [JsonRpcCommand]
  , txPairs            :: [(Timestamp, OutputTx)]
  , tLen               :: {-# UNPACK #-} !Int
  , blocksAndNewChains :: [Either OutputGenesis OutputBlock]
  , bLen               :: {-# UNPACK #-} !Int
  , createBlock        :: !Bool
  , privateTxs         :: [OutputTx]
  }

newInBatch :: VmInEventBatch
newInBatch = InBatch [] [] [] 0 [] 0 False []

insertInBatch :: VmInEvent -> VmInEventBatch -> VmInEventBatch
insertInBatch e b = case e of
  VmGenesis og -> b{ blocksAndNewChains = (Left og):blocksAndNewChains b}
  VmVoteToMake r d s -> b{ votesToMake = (r,d,s):votesToMake b}
  VmJsonRpcCommand j -> b{ rpcCommands = j:rpcCommands b}
  VmTx ts t -> b{ txPairs = (ts,t):txPairs b, tLen = tLen b + 1}
  VmBlock ob -> b{ blocksAndNewChains = (Right ob):blocksAndNewChains b, bLen = bLen b + 1}
  VmCreateBlockCommand -> b{ createBlock = True }
  VmPrivateTx otx -> b { privateTxs = otx : privateTxs b }

data VmOutEvent = OutAction Action
                | OutBlock OutputBlock
                | OutIndexEvent IndexEvent
                | OutToStateDiff Word256 ChainInfo Keccak256
                | OutStateDiff StateDiff
                | OutLog LogDB
                | OutEvent EventDB
                | OutTXR TransactionResult
                | OutASM (Map Account AddressStateModification)
                | OutJSONRPC String B.ByteString

data VmOutEventBatch = OutBatch
  { outActions      :: DL.DList Action
  , outExecResults  :: DL.DList ExecResults
  , outBlocks       :: DL.DList OutputBlock
  , outIndexEvents  :: DL.DList IndexEvent
  , outToStateDiffs :: DL.DList (Word256, ChainInfo, Keccak256)
  , outStateDiffs   :: DL.DList StateDiff
  , outLogs         :: DL.DList LogDB
  , outEvents       :: DL.DList EventDB
  , outTXRs         :: DL.DList TransactionResult
  , outASMs         :: DL.DList (Map Account AddressStateModification)
  , outJSONRPCs     :: DL.DList (String, B.ByteString)
  }

newOutBatch :: VmOutEventBatch
newOutBatch = OutBatch DL.empty
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

insertOutBatch :: VmOutEvent -> VmOutEventBatch -> VmOutEventBatch
insertOutBatch e b = case e of
  OutAction a          -> b{ outActions = outActions b `DL.snoc` a }
  OutBlock a           -> b{ outBlocks = outBlocks b `DL.snoc` a }
  OutIndexEvent a      -> b{ outIndexEvents = outIndexEvents b `DL.snoc` a }
  OutToStateDiff x y z -> b{ outToStateDiffs = outToStateDiffs b `DL.snoc` (x,y,z) }
  OutStateDiff a       -> b{ outStateDiffs = outStateDiffs b `DL.snoc` a }
  OutLog a             -> b{ outLogs = outLogs b `DL.snoc` a }
  OutEvent a           -> b{ outEvents = outEvents b `DL.snoc` a }
  OutTXR a             -> b{ outTXRs = outTXRs b `DL.snoc` a }
  OutASM a             -> b{ outASMs = outASMs b `DL.snoc` a }
  OutJSONRPC x y       -> b{ outJSONRPCs = outJSONRPCs b `DL.snoc` (x,y) }
