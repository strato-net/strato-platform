
module Raw (
  doit
  ) where

import Text.PrettyPrint.ANSI.Leijen hiding ((<$>), (</>))

import Blockchain.Format

import DumpLevelDB ()
import Util

--import Debug.Trace

doit::String->IO ()
doit filename = do
  ldbForEach filename $ \key val ->
    putStrLn $ "----------\n"
      ++ show (pretty key)
      ++ ": "
      ++ format val
