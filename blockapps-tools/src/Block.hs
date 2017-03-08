module Block 
    (
     doit
    ) where

import DumpLevelDB

import Blockchain.Format

doit::String->String->IO ()
doit dbtype h = showKeyVal format dbtype "blockchain" (if h == "-" then Nothing else Just h)






