module BlockApps.Tools.Hash where

import BlockApps.Tools.DumpLevelDB
import Text.Format

doit :: String -> String -> IO ()
doit dbtype h = showKeyVal format dbtype "state" (if h == "-" then Nothing else Just h)
