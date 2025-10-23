
module Blockchain.GenesisBlocks.Builder where

import Blockchain.Data.GenesisInfo
import Blockchain.GenesisBlocks.Contracts.GovernanceV2
import Blockchain.GenesisBlocks.Contracts.UserRegistry
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Validator

buildGenesisInfo :: [Address] -> [Validator] -> [Address] -> GenesisInfo -> GenesisInfo
buildGenesisInfo extraFaucets validators admins gi =
  let faucetBalance = 0x1000000000000000000000000000000000000000000000000000000000000
      faucetAccounts = map (flip NonContract faucetBalance) extraFaucets
   in insertUserRegistryContract
        . insertMercataGovernanceContract validators admins
        $ gi {genesisInfoAccountInfo = faucetAccounts ++ (genesisInfoAccountInfo gi)}

