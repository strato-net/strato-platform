{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

import BlockApps.Logging
import Blockchain.Blockstanbul
import Blockchain.Blockstanbul.BenchmarkLib
import Control.Monad.Trans.State.Lazy
import Criterion.Main

-- Note: it may be worthwhile to add more layers so that it resembles
-- the sequencer
runBlockstanbul :: StateT BlockstanbulContext (LoggingT IO) a -> IO a
runBlockstanbul = runNoLoggingT . flip evalStateT benchContext

instance HasBlockstanbulContext (StateT BlockstanbulContext (LoggingT IO)) where
  getBlockstanbulContext = gets Just
  putBlockstanbulContext = put

sendAllMessagesBench :: Int -> Int -> IO [OutEvent]
sendAllMessagesBench txcount txsize =
  runBlockstanbul . sendAllMessages $ [UnannouncedBlock $ makeBlock txcount txsize]

pageTest :: Int -> Benchmark
pageTest n = bench (show n ++ "x4KB") . nfIO . sendAllMessagesBench n $ 4092

slabTest :: Int -> Benchmark
slabTest n = bench (show n ++ "x4MB") . nfIO . sendAllMessagesBench n $ 4 * 1028 * 1028

shebangTest :: Int -> Benchmark
shebangTest n = bench (show n ++ "x1GB") . nfIO . sendAllMessagesBench n $ 4 * 1028 * 1028 * 1028

main :: IO ()
main =
  defaultMain $
    [bench "0x0" . nfIO . sendAllMessagesBench 0 $ 0]
      ++ map pageTest [10, 20, 40, 80, 160, 320, 640, 1280]
      ++ map slabTest [10, 20, 40, 80, 160, 320, 640, 1280]
      ++ map shebangTest [1, 2, 4, 8, 16, 32]
