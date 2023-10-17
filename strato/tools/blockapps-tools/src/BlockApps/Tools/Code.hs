module BlockApps.Tools.Code where

import BlockApps.Tools.DumpLevelDB
import Blockchain.Strato.Model.Code
import Data.ByteString.Short (toShort)

doit :: String -> String -> IO ()
doit dbtype h = showKeyVal (show . Code . toShort) dbtype "code" (if h == "-" then Nothing else Just h)
