
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
  -- Capacity 1: the sources hand off to the sink with no backlog. When the sink
  -- stalls (e.g. a slow Kafka produce to the sequencer), the sources block and
  -- backpressure propagates to the peer sockets instead of buffering messages in
  -- memory. A larger buffer let per-peer backlogs accumulate and, under load,
  -- grow across all peers until the process was OOM-killed.
  channel <- atomically $ newTBMChan 1

  mapConcurrently_ runConduit $
    (sourceTBMChan channel .| sink):
    (map (.| sinkTBMChan channel) sources)
