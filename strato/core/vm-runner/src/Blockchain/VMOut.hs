{-# LANGUAGE OverloadedStrings #-}

-- | Where the block loop's output events go. Replaces the @ConduitT a
-- VmOutEvent@ layer the loop used to run in: events are routed straight to
-- the stream from 'ContextM' instead of being yielded up a transformer.
module Blockchain.VMOut (emitOut) where

import qualified Blockchain.Data.TXOrigin as TO
import Blockchain.EthConf
import qualified Blockchain.EthConf.Model as Conf
import Blockchain.Event
import Blockchain.JsonRpcCommand (produceResponse)
import Blockchain.Model.WrappedBlock
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka
import Blockchain.Strato.Indexer.Kafka (produceIndexEvents)
import Blockchain.Strato.Indexer.Model (IndexEvent (..))
import Blockchain.Stream.VMEvent
import Blockchain.Timing
import Blockchain.VMContext
import Blockchain.VMMetrics
import Blockchain.Wiring ()
import Control.Monad

emitOut :: VmOutEvent -> ContextM ()
emitOut (OutVMEvents vmes) = void $ produceVMEvents vmes
emitOut (OutIndexEvent e) = void $ produceIndexEvents [e]
emitOut (OutStateDiff diff) = void $ produceIndexEvents [StateDiffEntry diff]
emitOut (OutASM asm) =
  when (not $ Conf.sqlDiff $ Conf.vmConfig ethConf) $
    timeit "produceAddressStateUpdates" (Just vmBlockInsertionMined) $
      void $ produceIndexEvents [AddressStateUpdates asm]
emitOut (OutJSONRPC r) = produceResponse r
emitOut (OutBlock o) = void $ writeUnseqEvents [IEBlock $ blockToIngestBlock TO.Quarry $ outputBlockToBlock o]
emitOut (OutBlockVerificationFailure _) = pure ()
emitOut (OutGetMPNodes mpNodes) = void $ writeUnseqEvents [IEGetMPNodes mpNodes]
emitOut (OutMPNodesResponse o nds) = void $ writeUnseqEvents [IEMPNodesResponse o nds]
emitOut (OutPreprepareResponse dec) = void $ writeUnseqEvents [IEPreprepareResponse dec]
