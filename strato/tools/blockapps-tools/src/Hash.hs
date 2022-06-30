module Hash where

import           DumpLevelDB
import           Text.Format

doit :: String -> String -> IO ()
doit dbtype h = showKeyVal format dbtype "state" (if h == "-" then Nothing else Just h)






