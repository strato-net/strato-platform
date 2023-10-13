{-# OPTIONS_GHC -fno-warn-missing-fields #-}
{-# OPTIONS_GHC -fno-warn-unused-top-binds #-}

import BlockApps.Logging
import Blockchain.Blockstanbul
import qualified Blockchain.Blockstanbul.BenchmarkLib as PBFT
import Blockchain.Data.Transaction
import Blockchain.Sequencer
import Blockchain.Sequencer.CablePackage
import Blockchain.Sequencer.Monad
import ClassyPrelude (atomically)
import Control.Concurrent.STM.TMChan
import Control.Monad.Reader
import Control.Monad.State
import Control.Monad.Trans.Resource
import Criterion.Main
import Data.Sequence as Q

noLog :: Loc -> LogSource -> LogLevel -> LogStr -> IO ()
noLog _ _ _ _ = return ()

runFakeSequencerM :: SequencerConfig -> SequencerContext -> SequencerM a -> IO a
runFakeSequencerM cfg ctx mv =
  runNoLoggingT
    . runResourceT
    . flip runReaderT cfg
    $ evalStateT mv ctx

benchConfig :: IO SequencerConfig
benchConfig = do
  ch <- atomically newTMChan
  cp <- atomically newCablePackage
  return
    SequencerConfig
      { blockstanbulBlockPeriod = 0,
        blockstanbulRoundPeriod = 1000000,
        blockstanbulTimeouts = ch,
        cablePackage = cp
      }

benchContext :: SequencerContext
benchContext =
  SequencerContext
    { _vmEvents = Q.empty,
      _p2pEvents = Q.empty,
      _blockstanbulContext = Just PBFT.benchContext
    }

blockstanbulSendBench :: Int -> Int -> IO ()
blockstanbulSendBench txcount txsize = do
  cfg <- benchConfig
  runFakeSequencerM cfg benchContext
    . blockstanbulSend
    $ [UnannouncedBlock $ PBFT.makeBlock txcount txsize]

pageTest :: Int -> Benchmark
pageTest n = bench (show n ++ "x 4KB") . nfIO . blockstanbulSendBench n $ 4092

slabTest :: Int -> Benchmark
slabTest n = bench (show n ++ "x 4MB") . nfIO . blockstanbulSendBench n $ 4 * 1028 * 1028

-- size per 100 contracts
sizePer100 :: Int -> Benchmark
sizePer100 n = bench ("100 contracts at " ++ show n ++ " bytes") . nfIO . blockstanbulSendBench 100 $ n

mapWhoSigned :: Benchmark
mapWhoSigned =
  bench "40 whoSignedThisTransaction contracts at 4MB"
    . nf (map whoSignedThisTransaction)
    . Prelude.replicate 40
    . PBFT.oneTX
    $ 4 * 1024 * 1024

main :: IO ()
main =
  defaultMain $
    [bench "0x0" . nfIO . blockstanbulSendBench 0 $ 0]
      ++ map pageTest [20, 80, 320, 1280]
      ++ map slabTest [10, 20, 40]
      ++ [mapWhoSigned]
