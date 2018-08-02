{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}

module DumpKafkaSequencer where

import           Control.Monad.IO.Class
import           Network.Kafka.Protocol

import           Blockchain.EthConf
import           Blockchain.Sequencer.Kafka
import           Blockchain.Stream.Raw      (setDefaultKafkaState)

dumpKafkaSequencer :: Offset -> IO ()
dumpKafkaSequencer ofs = do
  mapM_ putStrLn [ "~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ dumpKafkaSequencer ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~"
                 , "DEPRECATED!!! seqEvents has been split into two topics: seqVmEvents, and seqP2pEvents."
                 , "Please use dumpKafkaSequencerVM or dumpKafkaSequencerP2P instead."
                 , "~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~"
                 , ""
                 ]
  dumpKafkaSequencerVM ofs

dumpKafkaSequencerVM :: Offset -> IO ()
dumpKafkaSequencerVM startingBlock = do
  ret <- runKafkaConfigured "queryStrato" $ doConsume' startingBlock
  case ret of
    Left e  -> error $ show e
    Right _ -> return ()
  where
    doConsume' offset = do
      setDefaultKafkaState
      seqEvents <- readSeqVmEvents offset
      liftIO . putStrLn . unlines $ show <$> seqEvents
      doConsume' (offset + fromIntegral (length seqEvents))

dumpKafkaSequencerP2P :: Offset -> IO ()
dumpKafkaSequencerP2P startingBlock = do
  ret <- runKafkaConfigured "queryStrato" $ doConsume' startingBlock
  case ret of
    Left e  -> error $ show e
    Right _ -> return ()
  where
    doConsume' offset = do
      setDefaultKafkaState
      seqEvents <- readSeqP2pEvents offset
      liftIO . putStrLn . unlines $ show <$> seqEvents
      doConsume' (offset + fromIntegral (length seqEvents))
