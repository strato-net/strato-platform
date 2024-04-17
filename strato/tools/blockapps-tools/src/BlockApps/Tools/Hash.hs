module BlockApps.Tools.Hash where

import BlockApps.Tools.DumpLevelDB
import Text.Format

doit :: String -> IO ()
doit h = showKeyVal format "hash" (if h == "-" then Nothing else Just h)
