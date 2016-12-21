
module RLP
    (
     doit
    ) where

import Blockchain.Data.RLP
import Blockchain.Format

import Util

--import Debug.Trace

doit::String->IO ()
doit filename = do
  ldbForEach filename $ \key val -> do
    putStrLn $ format key ++ ":" ++ tab ("\n" ++ formatRLPObject (rlpDeserialize val))
    putStrLn "--------------------"





