
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
  channel <- atomically $ newTBMChan 4096

  mapConcurrently_ runConduit $
    (sourceTBMChan channel .| sink):
    (map (.| sinkTBMChan channel) sources)
