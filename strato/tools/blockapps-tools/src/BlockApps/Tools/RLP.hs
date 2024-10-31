module BlockApps.Tools.RLP where

import BlockApps.Tools.Util
import Blockchain.Data.RLP
import Text.Format

doit :: String -> IO ()
doit filename = ldbForEach ("/tmp/.ethereumH/" ++ filename) $ \key val -> do
  putStrLn $ format key ++ ":" ++ tab ("\n" ++ format (rlpDeserialize val))
  putStrLn "--------------------"
