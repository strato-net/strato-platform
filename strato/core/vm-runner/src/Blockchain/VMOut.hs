{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

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
import Blockchain.Strato.Indexer.Model (IndexEvent (..), indexEventLabel)
import Blockchain.Stream.VMEvent
import Blockchain.Timing
import Blockchain.VMContext
import Blockchain.VMMetrics
import Blockchain.Wiring ()
import Control.Monad
import BlockApps.Logging
import Data.List (intercalate)
import qualified Data.Text as T

emitOut :: VmOutEvent -> ContextM ()
emitOut (OutVMEvents vmes) = void $ produceVMEvents vmes
emitOut (OutIndexEvent e) = sendIndexEvents [e]
emitOut (OutStateDiff diff) = sendIndexEvents [StateDiffEntry diff]
emitOut (OutASM asm) =
  when (not $ Conf.sqlDiff $ Conf.vmConfig ethConf) $
    timeit "produceAddressStateUpdates" (Just vmBlockInsertionMined) $
      sendIndexEvents [AddressStateUpdates asm]
emitOut (OutJSONRPC r) = produceResponse r
emitOut (OutBlock o) = void $ writeUnseqEvents [IEBlock $ blockToIngestBlock TO.Quarry $ outputBlockToBlock o]
emitOut (OutBlockVerificationFailure _) = pure ()
emitOut (OutGetMPNodes mpNodes) = void $ writeUnseqEvents [IEGetMPNodes mpNodes]
emitOut (OutMPNodesResponse o nds) = void $ writeUnseqEvents [IEMPNodesResponse o nds]
emitOut (OutPreprepareResponse dec) = void $ writeUnseqEvents [IEPreprepareResponse dec]

-- | Publish index events and report, without rethrowing, any the broker
-- refused. Losing one leaves a hole the indexer fills on its next resync;
-- rethrowing here would kill vm-runner and, through convoke, the whole node --
-- which is how helium block 595971 took all four validators offline (on a
-- different topic; see 'produceIndexEvents').
-- So this logs at error level, names the events, and lets block application
-- continue.
sendIndexEvents :: [IndexEvent] -> ContextM ()
sendIndexEvents events = do
  rejections <- produceIndexEvents events
  unless (null rejections) $
    $logErrorS "emitOut/indexEvent" . T.pack $
      "DROPPED index events ["
        ++ intercalate ", " (map indexEventLabel events)
        ++ "]; the indexer will be missing them until a resync. Broker said: "
        ++ intercalate "; " rejections
