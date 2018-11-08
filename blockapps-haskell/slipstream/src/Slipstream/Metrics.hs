{-# LANGUAGE OverloadedStrings #-}
module Slipstream.Metrics
  ( recordGlobals
  ) where

import Control.Monad.IO.Class
import qualified Data.Map.Strict as M
import qualified Data.Set as S
import Data.Text
import Prometheus

import Slipstream.Data.Globals

globalsSize :: Vector Text Gauge
globalsSize = unsafeRegister
            . vector "cache_type"
            . gauge
            $ Info "slipstream_globals_size" "Number of cache entries in Globals"

recordGlobals :: MonadIO m => Globals -> m ()
recordGlobals g = liftIO $ do
  let rec  :: Text -> (Globals -> Int) -> IO ()
      rec lab acc = withLabel globalsSize lab (flip setGauge . fromIntegral . acc $ g)
  rec "created_contracts" (S.size . createdContracts)
  rec "history_list" (S.size . historyList)
  rec "no_index_list" (S.size . noIndexList)
  rec "contract_states" (M.size . contractStates)
