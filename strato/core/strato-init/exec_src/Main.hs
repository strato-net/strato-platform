{-# LANGUAGE TemplateHaskell #-}

import           HFlags

import           BlockApps.Logging() -- Import the --minLogLevel flag
import           Blockchain.Setup
import           Blockchain.Init.Options (flags_genesisBlockName)

main::IO ()
main = do
  s <- $initHFlags "Setup EthereumH DBs"
  putStrLn $ "strato-init with unknown args: " ++ unlines s
  oneTimeSetup flags_genesisBlockName
