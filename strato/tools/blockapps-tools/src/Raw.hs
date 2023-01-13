module Raw where

import           Text.PrettyPrint.ANSI.Leijen hiding ((<$>), (</>))

import           DumpLevelDB                  ()
import           Text.Format
import           Util

doit :: String -> IO ()
doit filename = ldbForEach filename $ \key val ->
    putStrLn $ "----------\n"
      ++ show (pretty key)
      ++ ": "
      ++ format val
