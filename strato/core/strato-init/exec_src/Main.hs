{-# LANGUAGE TemplateHaskell #-}

import BlockApps.Logging ()
-- Import the --minLogLevel flag

import Blockchain.Init.Options (flags_genesisBlockName)
import Blockchain.Setup
import HFlags

main :: IO ()
main = do
  s <- $initHFlags "Setup EthereumH DBs"
  putStrLn $ "strato-init with unknown args: " ++ unlines s
  oneTimeSetup flags_genesisBlockName
