module Psql where

import           Blockchain.EthConf

psql :: IO ()
psql = putStrLn $ "psql " ++ database (sqlConfig ethConf)

