{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.GenesisBlocks.Contracts.UserRegistry (
  insertUserRegistryContract
  ) where

import Blockchain.Data.GenesisInfo
import Blockchain.GenesisBlocks.Contracts.TH
import Blockchain.Strato.Model.CodePtr
import qualified Blockchain.Strato.Model.Keccak256 as KECCAK256
import Data.ByteString (ByteString)
import Data.Text.Encoding



-- | Inserts a User Registry contract into the genesis block with the BlockApps root cert as owner
insertUserRegistryContract :: GenesisInfo -> GenesisInfo
insertUserRegistryContract gi =
  gi
    { genesisInfoAddressInfo = initialAccounts ++ [registryAcct],
      genesisInfoCodeInfo = initialCode ++ [CodeInfo (decodeUtf8 userRegistryContract) (Just "UserRegistry")]
    }
  where
    initialAccounts = genesisInfoAddressInfo gi
    initialCode = genesisInfoCodeInfo gi

    registryAcct =
      SolidVMContractWithStorage
        0x720
        720
        (SolidVMCode "UserRegistry" (KECCAK256.hash userRegistryContract))
        $ []

userRegistryContract :: ByteString
userRegistryContract = $(typecheckAndEmbedFile "resources/strato/UserRegistry.sol")
