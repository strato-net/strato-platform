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
import Data.Map.Strict (Map)
import qualified Data.Map.Strict as Map
import Data.Maybe
import Data.String
import Data.Text.Encoding



-- | Inserts a User Registry contract into the genesis block with the BlockApps root cert as owner
insertUserRegistryContract :: GenesisInfo -> GenesisInfo
insertUserRegistryContract gi =
  gi
    { genesisInfoAccountInfo = initialAccounts ++ [registryAcct, rootAcct],
      genesisInfoCodeInfo = initialCode ++ [CodeInfo (decodeUtf8 userRegistryContract) (Just "UserRegistry")]
    }
  where
    initialAccounts = genesisInfoAccountInfo gi
    initialCode = genesisInfoCodeInfo gi

    rootAcct =
      SolidVMContractWithStorage
        0x840a84f572cff5b12c8ed176565e86f10d3b820e -- TODO: Remove. This is just for current genesis block compatibility
        123
        (SolidVMCode "User" (KECCAK256.hash userRegistryContract))
        [ (".commonName", fromString "Admin")
        ]

    registryAcct =
      SolidVMContractWithStorage
        0x720
        720
        (SolidVMCode "UserRegistry" (KECCAK256.hash userRegistryContract))
        $ []

userRegistryFilePath :: FilePath
userRegistryFilePath = "UserRegistry.sol"

embeddedFiles :: [(FilePath, ByteString)]
embeddedFiles = $(typecheckAndEmbedDir "resources/strato/user" Nothing)

fileMap :: Map FilePath ByteString
fileMap = Map.fromList embeddedFiles

fileContents :: FilePath -> ByteString
fileContents = fromJust . flip Map.lookup fileMap

userRegistryContract :: ByteString
userRegistryContract = fileContents userRegistryFilePath
