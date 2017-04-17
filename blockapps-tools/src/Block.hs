module Block where

import           Blockchain.Format
import           DumpLevelDB

doit :: String -> String -> IO ()
doit dbtype h = showKeyVal format dbtype "blockchain" (if h == "-" then Nothing else Just h)






