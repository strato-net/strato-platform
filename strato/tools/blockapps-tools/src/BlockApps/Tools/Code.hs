module BlockApps.Tools.Code where

import BlockApps.Tools.DumpLevelDB
import Blockchain.Strato.Model.Code

doit :: String -> IO ()
doit h = showKeyVal (show . Code) "code" (if h == "-" then Nothing else Just h)
