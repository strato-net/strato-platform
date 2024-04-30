{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Sequencer.Kafka.Metrics where

import Blockchain.Sequencer.Event
import Control.Monad
import Control.Monad.IO.Class
import Data.Text
import Prometheus

buildCounter :: Text -> Text -> Vector Text Counter
buildCounter name desc =
  unsafeRegister
    . vector "event"
    . counter
    $ Info name desc

{-# NOINLINE unseqWrites #-}
unseqWrites :: Vector Text Counter
unseqWrites = buildCounter "unseq_writes" "Events written to unseq_events by kind"

{-# NOINLINE unseqReads #-}
unseqReads :: Vector Text Counter
unseqReads = buildCounter "unseq_reads" "Events read from unseq_events by kind"

{-# NOINLINE seqP2PWrites #-}
seqP2PWrites :: Vector Text Counter
seqP2PWrites = buildCounter "seq_p2p_writes" "Events written to seq_p2p_events by kind"

{-# NOINLINE seqP2PReads #-}
seqP2PReads :: Vector Text Counter
seqP2PReads = buildCounter "seq_p2p_reads" "Events read from seq_p2p_events by kind"

{-# NOINLINE seqVMWrites #-}
seqVMWrites :: Vector Text Counter
seqVMWrites = buildCounter "seq_vm_writes" "Events written to seq_vm_events by kind"

{-# NOINLINE seqVMReads #-}
seqVMReads :: Vector Text Counter
seqVMReads = buildCounter "seq_vm_reads" "Events read from seq_vm_events by kind"

recordEvents :: (ShowConstructor a, MonadIO m) => Vector Text Counter -> [a] -> m ()
recordEvents vec = recordEvents' vec . fmap (show . showConstructor)

recordEvents' :: MonadIO m => Vector Text Counter -> [String] -> m ()
recordEvents' vec events = liftIO $
  forM_ events $ \constr -> do
    withLabel vec (pack constr) incCounter
