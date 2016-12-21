
module Hash
    (
     doit
    ) where

import DumpLevelDB

import Blockchain.Format

--import Debug.Trace

doit::String->String->IO ()
doit dbtype h = showKeyVal format dbtype "state" (if h == "-" then Nothing else Just h)






