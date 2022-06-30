module Block where

import           DumpLevelDB

import           Text.Format

doit :: String -> String -> IO ()
doit dbtype h = showKeyVal format dbtype "blockchain" (if h == "-" then Nothing else Just h)






