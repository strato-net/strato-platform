{-# LANGUAGE TemplateHaskell #-}
module Blockchain.Blockstanbul.Metrics where

import           Prometheus                                as P

pbftPrepare :: P.Metric P.Counter
pbftPrepare = P.unsafeRegisterIO $ counter (P.Info "pbft_prepare_messages" "pbft counter for prepare messages")

pbftCommit :: P.Metric P.Counter
pbftCommit = P.unsafeRegisterIO $ counter (P.Info "pbft_commit_messages" "pbft counter for commited messages")

pbftPreprepare :: P.Metric P.Counter
pbftPreprepare = P.unsafeRegisterIO $ counter (P.Info "pbft_preprepare_messages" "pbft counter for preprepare messages")

pbftRoundchange :: P.Metric P.Counter
pbftRoundchange = P.unsafeRegisterIO $ counter (P.Info "pbft_roundchange_messages" "pbft counter for roundchange messages")
