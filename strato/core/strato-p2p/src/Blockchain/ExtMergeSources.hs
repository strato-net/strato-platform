
module Blockchain.ExtMergeSources (
    mergeConnect,
    ) where

import           Control.Monad.Trans.Resource
import           Data.Conduit
import           Data.Conduit.TMChan
import           UnliftIO.Async
import           UnliftIO.STM

mergeConnect :: MonadUnliftIO m =>
                [ConduitM () a m ()] -> ConduitT a Void m () -> m ()
mergeConnect sources sink = do
  -- Capacity 128: bounded, but deep enough to pipeline. Two failure modes
  -- constrain this number:
  --
  --  * Too large (4096): a stalled sink let per-peer backlogs of multi-MB
  --    block messages accumulate across all peers until the process was
  --    OOM-killed. The bound is what propagates backpressure to the peer
  --    sockets, so it must stay small enough that capacity x max message
  --    size x peers is affordable.
  --  * Capacity 1 (the original OOM fix) removed ALL pipelining: while the
  --    sink was busy (e.g. a synchronous Kafka produce of a 500-block
  --    BlockBodies batch, or a slow socket write), the peer's socket reader
  --    could not even hand off the next already-received message, and the
  --    timer/sequencer sources had to win an unfair STM race against the
  --    socket firehose for the single slot. During fresh sync this collapsed
  --    block download throughput to a batch every few minutes.
  channel <- atomically $ newTBMChan 128

  mapConcurrently_ runConduit $
    (sourceTBMChan channel .| sink):
    (map (.| sinkTBMChan channel) sources)
