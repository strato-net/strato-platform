module BlockApps.Tools.Raw where

import BlockApps.Tools.DumpLevelDB ()
import BlockApps.Tools.Util
import Text.Format

doit :: String -> IO ()
doit filename = ldbForEach ("/tmp/.ethereumH/" ++ filename) $ \key val ->
  putStrLn $
    "----------\n"
      ++ format key
      ++ ": "
      ++ format val
