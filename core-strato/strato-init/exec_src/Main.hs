{-# LANGUAGE TemplateHaskell #-}

import           HFlags

import           Blockchain.Setup
import           Blockchain.Init.Options(flags_genesisBlockName)
import           Blockchain.Output() -- Import the --minLogLevel flag

main::IO ()
main = do
  s <- $initHFlags "Setup EthereumH DBs"
  putStrLn $ "strato-init with args: " ++ unlines s
  oneTimeSetup flags_genesisBlockName
