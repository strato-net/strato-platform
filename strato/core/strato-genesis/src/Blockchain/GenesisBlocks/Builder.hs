
module Blockchain.GenesisBlocks.Builder where

import BlockApps.X509
import Blockchain.Data.GenesisInfo
import Blockchain.Generation
  ( insertCertRegistryContract,
    insertMercataGovernanceContract,
    insertUserRegistryContract,
  )
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainMember

buildGenesisInfo :: [Address] -> [X509Certificate] -> [ChainMemberParsedSet] -> [ChainMemberParsedSet] -> GenesisInfo -> GenesisInfo
buildGenesisInfo extraFaucets extraCerts validators admins gi =
  let faucetBalance = 0x1000000000000000000000000000000000000000000000000000000000000
      faucetAccounts = map (flip NonContract faucetBalance) extraFaucets
   in insertUserRegistryContract extraCerts
        . insertMercataGovernanceContract validators admins
        . insertCertRegistryContract extraCerts
        $ gi {genesisInfoAccountInfo = faucetAccounts ++ (genesisInfoAccountInfo gi)}

