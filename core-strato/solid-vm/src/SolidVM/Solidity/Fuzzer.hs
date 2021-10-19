module SolidVM.Solidity.Fuzzer 
  ( runFuzzer
  ) where

import           CodeCollection
import           Data.Source

fuzz :: CodeCollection -> IO ()
fuzz = const $ pure ()

runFuzzer :: (Traversable t)
          => (SourceMap -> t CodeCollection)
          -> SourceMap
          -> IO (t ())
runFuzzer compile = traverse fuzz . compile