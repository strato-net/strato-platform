{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

module Blockchain.Blockstanbul.Metrics where

import Blockchain.Blockstanbul.Messages
import Control.Monad.IO.Class
import Data.Text
import Prometheus

{-# NOINLINE inEventMetric #-}
inEventMetric :: Vector Text Counter
inEventMetric =
  unsafeRegister
    . vector "inevent_type"
    . counter
    $ Info "pbft_inevent" "Count of pbft inEvent"

{-# NOINLINE outEventMetric #-}
outEventMetric :: Vector Text Counter
outEventMetric =
  unsafeRegister
    . vector "outevent_type"
    . counter
    $ Info "pbft_outevent" "Count of pbft outEvent"

{-# NOINLINE currentView #-}
currentView :: Vector Text Gauge
currentView =
  unsafeRegister
    . vector "view_field"
    . gauge
    $ Info "pbft_current_view" "Current (Roundno, Seqno) of PBFT"

recordView :: (MonadIO m) => View -> m ()
recordView View {..} = liftIO $ do
  withLabel currentView "round_number" (flip setGauge . fromIntegral $ _round)
  withLabel currentView "sequence_number" (flip setGauge . fromIntegral $ _sequence)

{-# NOINLINE validatorView #-}
validatorView :: Vector Text Gauge
validatorView =
  unsafeRegister
    . vector "view_field"
    . gauge
    $ Info "pbft_current_view" "The validator status of this node (1.0 = validator, 0.0 = non-validator))"

recordValidator :: MonadIO m => Bool -> Bool -> m ()
recordValidator iv vb = liftIO $ do
  let f b = if b then 1 else 0
  withLabel validatorView "is_validator" (`setGauge` (f iv))
  withLabel validatorView "validator_behavior" (`setGauge` (f vb))

{-# NOINLINE nodeIdentity #-}
nodeIdentity :: Vector Text Gauge
nodeIdentity =
  unsafeRegister
    . vector "address"
    . gauge
    $ Info "pbft_node_identity" "This node's own blockchain address, carried in the 'address' label (value is always 1.0)"

-- | Record this node's own address as a Prometheus gauge. The address is the
-- 40-char hex string (no 0x prefix) carried in the 'address' label; the gauge
-- value is always 1.0. Apex reads the label to surface the node address.
recordNodeIdentity :: MonadIO m => Text -> m ()
recordNodeIdentity addr = liftIO $ withLabel nodeIdentity addr (`setGauge` 1.0)

{-# NOINLINE authResults #-}
authResults :: Vector Text Counter
authResults =
  unsafeRegister
    . vector "outcome"
    . counter
    $ Info "pbft_auth_results" "Number of authn/authz successes and failures"

recordAuthResult :: MonadIO m => AuthResult -> m ()
recordAuthResult AuthSuccess = liftIO $ withLabel authResults "success" incCounter
recordAuthResult AuthFailure {} = liftIO $ withLabel authResults "failure" incCounter

{-# NOINLINE proposalCount #-}
proposalCount :: Counter
proposalCount =
  unsafeRegister
    . counter
    $ Info "pbft_proposal_count" "Number of blocks I proposed that were accepted by peers"

recordProposal :: MonadIO m => m ()
recordProposal = liftIO $ incCounter proposalCount

{-# NOINLINE historicBlocks #-}
historicBlocks :: Vector Text Counter
historicBlocks =
  unsafeRegister
    . vector "result"
    . counter
    $ Info "pbft_historic_blocks" "Results of replaying historic blocks"

acceptHistoric :: MonadIO m => m ()
acceptHistoric = liftIO $ withLabel historicBlocks "accept" incCounter

rejectHistoric :: MonadIO m => m ()
rejectHistoric = liftIO $ withLabel historicBlocks "reject" incCounter
