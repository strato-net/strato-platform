
module Blockchain.GenesisBlocks.Builder where

import Blockchain.Data.GenesisInfo
import Blockchain.GenesisBlocks.Contracts.GovernanceV2
import Blockchain.GenesisBlocks.Contracts.UserRegistry
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Validator

buildGenesisInfo :: [Validator] -> [Address] -> GenesisInfo -> GenesisInfo
buildGenesisInfo validatorList admins gi =
  insertUserRegistryContract
    . insertMercataGovernanceContract (admins !! 0) validatorList admins
    $ gi

