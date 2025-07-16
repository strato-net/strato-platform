module BlockApps.Tools.Code where

import BlockApps.Tools.DumpLevelDB
import Blockchain.Strato.Model.Code
import qualified Data.Text.Encoding as Text

doit :: String -> IO ()
doit h = showKeyVal (show . Code . Text.decodeUtf8) "code" (if h == "-" then Nothing else Just h)
