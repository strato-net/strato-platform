
module Blockchain.GenesisBlocks.Builder where

import BlockApps.X509
import Blockchain.Data.GenesisInfo
import Blockchain.GenesisBlocks.Contracts.CertRegistry
import Blockchain.GenesisBlocks.Contracts.GovernanceV2
import Blockchain.GenesisBlocks.Contracts.UserRegistry
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Validator
import Data.Text (Text)

buildGenesisInfo :: [Address] -> [X509Certificate] -> [Validator] -> [Text] -> GenesisInfo -> GenesisInfo
buildGenesisInfo extraFaucets extraCerts validators admins gi =
  let faucetBalance = 0x1000000000000000000000000000000000000000000000000000000000000
      faucetAccounts = map (flip NonContract faucetBalance) extraFaucets
   in insertUserRegistryContract extraCerts
        . insertMercataGovernanceContract validators admins
        . insertCertRegistryContract extraCerts
        $ gi {genesisInfoAccountInfo = faucetAccounts ++ (genesisInfoAccountInfo gi)}

