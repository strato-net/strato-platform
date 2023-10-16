module BlockApps.Tools.Raw where

import BlockApps.Tools.DumpLevelDB ()
import BlockApps.Tools.Util
import Text.Format
import Text.PrettyPrint.ANSI.Leijen hiding ((<$>), (</>))

doit :: String -> IO ()
doit filename = ldbForEach filename $ \key val ->
  putStrLn $
    "----------\n"
      ++ show (pretty key)
      ++ ": "
      ++ format val
