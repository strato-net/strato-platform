
module Block 
    (
     doit
    ) where

import DumpLevelDB

import Blockchain.Format

--import Debug.Trace

doit::String->String->IO ()
--doit dbtype h = showKeyVal (formatBlock . rlpDecode . rlpDeserialize) dbtype "blocks" (if h == "-" then Nothing else Just h)
doit dbtype h = showKeyVal format dbtype "blockchain" (if h == "-" then Nothing else Just h)






