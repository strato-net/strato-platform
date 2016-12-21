
module Code
    (
     doit
    ) where

import Blockchain.Data.Code

import DumpLevelDB

--import Debug.Trace

formatCode::Code->String
formatCode = show

doit::String->String->IO ()
doit dbtype h = showKeyVal (formatCode . Code) dbtype "state" (if h == "-" then Nothing else Just h)






