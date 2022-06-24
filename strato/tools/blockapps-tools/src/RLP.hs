module RLP where

import           Blockchain.Data.RLP
import           Text.Format
import           Util

doit :: String -> IO ()
doit filename = ldbForEach filename $ \key val -> do
    putStrLn $ format key ++ ":" ++ tab ("\n" ++ formatRLPObject (rlpDeserialize val))
    putStrLn "--------------------"





