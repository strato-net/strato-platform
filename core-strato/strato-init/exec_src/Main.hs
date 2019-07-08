{-# LANGUAGE TemplateHaskell #-}

import           HFlags

import           Blockchain.Setup
import           Blockchain.InitOptions()
import           Blockchain.Output() -- Import the --minLogLevel flag

defineFlag "genesisBlockName" "livenet" "use the alternate stablenet genesis block"
$(return []) --see https://github.com/nilcons/hflags/issues/8

main::IO ()
main = do
  s <- $initHFlags "Setup EthereumH DBs"
  putStrLn $ "strato-init with args: " ++ unlines s
  oneTimeSetup flags_genesisBlockName
