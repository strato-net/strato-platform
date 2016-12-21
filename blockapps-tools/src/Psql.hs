
module Psql where

import GHC.IO.Handle
import System.Process

import Blockchain.EthConf

psql::IO ()
psql = do
  putStrLn $ "psql " ++ database (sqlConfig ethConf)

{-
  (input, output, error, handle) <- runInteractiveCommand ("psql " ++ database (sqlConfig ethConf))

  putStrLn "before"

  hPutStr input "select * from p_peer;\n"

  putStrLn "middle"

  val <- hGetChar output
  putStrLn $ show val
-}
