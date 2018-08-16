{-# OPTIONS_GHC -fno-warn-missing-fields #-}
{-# OPTIONS_GHC -fno-warn-unused-top-binds #-}
import ClassyPrelude (atomically)
import Control.Concurrent.STM.TMChan
import Control.Monad.Logger
import Control.Monad.Reader
import Control.Monad.State
import Control.Monad.Trans.Resource
import Control.Parallel.Strategies
import Data.Sequence as Q

import Blockchain.Data.RLP
import Blockchain.Data.Transaction

import Blockchain.Blockstanbul
import qualified Blockchain.Blockstanbul.BenchmarkLib as PBFT
import Blockchain.Sequencer
import Blockchain.Sequencer.Monad
import Control.Monad.Stats

import Criterion.Main

noLog :: Loc -> LogSource -> LogLevel -> LogStr -> IO ()
noLog _ _ _ _ = return ()

runFakeSequencerM :: SequencerConfig -> SequencerContext -> SequencerM a -> IO a
runFakeSequencerM cfg ctx mv = do
    flip runLoggingT noLog
  . runResourceT
  . runNoStatsT
  . flip runReaderT cfg
  $ evalStateT mv ctx

benchConfig :: SequencerConfig
benchConfig = SequencerConfig {blockstanbulBlockPeriod = 0, blockstanbulRoundPeriod = 1000000}

benchContext :: IO SequencerContext
benchContext = do
  ch <- atomically newTMChan
  return SequencerContext { _vmEvents = Q.empty
                          , _p2pEvents = Q.empty
                          , _blockstanbulContext = Just PBFT.benchContext
                          , _blockstanbulTimeouts = ch
                          }

blockstanbulSendBench :: Int -> Int -> IO ()
blockstanbulSendBench txcount txsize = do
  ctx <- benchContext
  runFakeSequencerM benchConfig ctx
                      . blockstanbulSend
                      $ [NewBlock $ PBFT.makeBlock txcount txsize]

pageTest :: Int -> Benchmark
pageTest n = bench (show n ++ "x 4KB") . nfIO . blockstanbulSendBench n $ 4092

slabTest :: Int -> Benchmark
slabTest n = bench (show n ++ "x 4MB") . nfIO . blockstanbulSendBench n $ 4 * 1028 * 1028

shebangTest :: Int -> Benchmark
shebangTest n = bench (show n ++ " x 1GB") . nfIO . blockstanbulSendBench n $ 4 * 1028 * 1028 * 1028

-- size per 100 contracts
sizePer100 :: Int -> Benchmark
sizePer100 n = bench ("100 contracts at " ++ show n ++ " bytes") . nfIO . blockstanbulSendBench 100 $ n

mapWhoSigned :: Benchmark
mapWhoSigned = bench "80 whoSignedThisTransaction contracts at 4MB"
             . nf (map whoSignedThisTransaction)
             . Prelude.replicate 80
             . PBFT.oneTX
             $ 4 * 1024 * 1024

mapWhoSignedPar :: Benchmark
mapWhoSignedPar = bench "80 paralel whoSignedThisTransaction at 4MB"
                . nf (parMap rdeepseq whoSignedThisTransaction)
                . Prelude.replicate 80
                . PBFT.oneTX
                $ 4 * 1024 * 1024

benchRLP :: Benchmark
benchRLP = bench "RLP of 4MB transaction"
         . nf (rlpSerialize . rlpEncode)
         . PBFT.oneTX
         $ 4 * 1024 * 1024

main :: IO ()
main = defaultMain [benchRLP]
     -- [ bench "0x0" . nfIO . blockstanbulSendBench 0 $ 0]
    -- ++ map pageTest [10, 20, 40, 80, 160, 320, 640, 1280]
    -- ++ map slabTest [10, 20, 40, 80, 160, 320, 640, 1280]
    -- ++ map shebangTest [1, 2, 4, 8, 16, 32]
     -- map sizePer100 [0, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048,
     --                 4096, 8192, 16384, 32768, 65536, 131072, 262144, 524288,
     --                 1048576, 2097152, 4194304, 8388608, 16777216, 33554432,
     --                 67108864,134217728,26843556,536870912,1073741824]
    -- map sizePer100 [1,2,4,8,16,32,64,128,256,512,1024,2048,4096,8192,16384,32768,65536,131072,262144,524288,1048576,2097152,4194304,8388608,16777216,33554432,67108864,134217728,268435456,536870912,1073741824,2147483648,4294967296]
