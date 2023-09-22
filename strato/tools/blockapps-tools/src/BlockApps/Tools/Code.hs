module BlockApps.Tools.Code where

import BlockApps.Tools.DumpLevelDB
import Blockchain.Strato.Model.Code

doit :: String -> String -> IO ()
doit dbtype h = showKeyVal (show . Code) dbtype "code" (if h == "-" then Nothing else Just h)
