module Raw where

import           Blockchain.Format
import           DumpLevelDB                  ()
import           Text.PrettyPrint.ANSI.Leijen hiding ((<$>), (</>))
import           Util

doit :: String -> IO ()
doit filename = ldbForEach filename $ \key val ->
    putStrLn $ "----------\n"
      ++ show (pretty key)
      ++ ": "
      ++ format val
