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
import qualified Blockchain.Database.MerklePatricia as MP
import           Blockchain.DB.MemAddressStateDB
import           Blockchain.ExtWord
import           Blockchain.Sequencer.Event
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Indexer.Model    (IndexEvent (..))
import           Blockchain.Strato.Model.Action
import           Blockchain.Strato.StateDiff
import qualified Data.DList                         as DL
import           Data.Map                           (Map)

type VmInEvent = VmEvent

data VmInEventBatch = InBatch
  { newChains   :: [OutputGenesis]
  , votesToMake :: [(Address, Bool, Address)]
  , rpcCommands :: [JsonRpcCommand]
  , txPairs     :: [(Timestamp, OutputTx)]
  , tLen        :: {-# UNPACK #-} !Int
  , blocks      :: [OutputBlock]
  , bLen        :: {-# UNPACK #-} !Int
  , createBlock :: !Bool
  }

newInBatch :: VmInEventBatch
newInBatch = InBatch [] [] [] [] 0 [] 0 False

insertInBatch :: VmInEvent -> VmInEventBatch -> VmInEventBatch
insertInBatch e b = case e of
  VmGenesis og -> b{ newChains = og:newChains b}
  VmVoteToMake r d s -> b{ votesToMake = (r,d,s):votesToMake b}
  VmJsonRpcCommand j -> b{ rpcCommands = j:rpcCommands b}
  VmTx ts t -> b{ txPairs = (ts,t):txPairs b, tLen = tLen b + 1}
  VmBlock ob -> b{ blocks = ob:blocks b, bLen = bLen b + 1}
  VmCreateBlockCommand -> b{ createBlock = True }
  _ -> b

data VmOutEvent = OutAction Action
                | OutBlock OutputBlock
                | OutIndexEvent IndexEvent
                | OutToStateDiff Word256 ChainInfo MP.StateRoot
                | OutStateDiff StateDiff
                | OutLog LogDB
                | OutEvent EventDB
                | OutTXR TransactionResult
                | OutASM (Maybe Word256) (Map Address AddressStateModification)

data VmOutEventBatch = OutBatch
  { outActions      :: DL.DList Action
  , outBlocks       :: DL.DList OutputBlock
  , outIndexEvents  :: DL.DList IndexEvent
  , outToStateDiffs :: DL.DList (Word256, ChainInfo, MP.StateRoot)
  , outStateDiffs   :: DL.DList StateDiff
  , outLogs         :: DL.DList LogDB
  , outEvents       :: DL.DList EventDB
  , outTXRs         :: DL.DList TransactionResult
  , outASMs         :: DL.DList (Maybe Word256, (Map Address AddressStateModification))
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
  OutASM chainId a     -> b{ outASMs = outASMs b `DL.snoc` (chainId, a) }

