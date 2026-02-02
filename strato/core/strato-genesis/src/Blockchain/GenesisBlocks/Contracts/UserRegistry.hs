{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.GenesisBlocks.Contracts.UserRegistry (
  insertUserRegistryContract
  ) where

import Blockchain.Data.GenesisInfo
import Blockchain.GenesisBlocks.Contracts.TH
import Blockchain.Strato.Model.CodePtr
import qualified Blockchain.Strato.Model.Keccak256 as KECCAK256
import qualified Data.Aeson as JSON
import Data.ByteString (ByteString)
import qualified Data.ByteString.Lazy as BL
import qualified Data.Text as Text
import Data.Text.Encoding
import SolidVM.Model.Storable hiding (size)
import System.FilePath (takeFileName)



insertUserRegistryContract :: GenesisInfo -> GenesisInfo
insertUserRegistryContract gi =
  gi
    { addressInfo = initialAccounts ++ [proxyAcct],
      codeInfo = initialCode ++ [CodeInfo (decodeUtf8 userRegistryContract) (Just "UserRegistry")]
    }
  where
    initialAccounts = addressInfo gi
    initialCode = codeInfo gi

    proxyAddr = 0x720
    owner = 0x100c

    proxyAcct =
      SolidVMContractWithStorage
        proxyAddr
        720
        (SolidVMCode "UserRegistry" (KECCAK256.hash userRegistryContract))
        [ ("_owner", BAddress owner)
        , ("logicContract", BAddress 0)
        , ("canCreateUserDelegate", BAddress 0)
        ]

embeddedFiles :: [(FilePath, ByteString)]
embeddedFiles = $(typecheckAndEmbedFiles "resources"
  [ "contracts/abstract/ERC20/access/Authorizable.sol"
  , "contracts/abstract/ERC20/access/Ownable.sol"
  , "contracts/abstract/ERC20/utils/Context.sol"
  , "contracts/concrete/Admin/AdminRegistry.sol"
  , "contracts/concrete/Proxy/Proxy.sol"
  , "strato/UserRegistry.sol"
  ])

userRegistryContracts :: [[String]]
userRegistryContracts = map (\(fp, bs) -> [takeFileName fp, Text.unpack $ decodeUtf8 bs]) embeddedFiles

userRegistryContract :: ByteString
userRegistryContract = BL.toStrict $ JSON.encode userRegistryContracts
