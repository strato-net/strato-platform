{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}

module Blockchain.GenesisBlocks.Contracts.GovernanceV2 (
  insertMercataGovernanceContract
  ) where

import           Blockchain.Data.GenesisInfo
import           Blockchain.GenesisBlocks.Contracts.TH
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.CodePtr
import qualified Blockchain.Strato.Model.Keccak256 as KECCAK256
import           Blockchain.Strato.Model.Validator
import qualified Data.Aeson                        as JSON
import           Data.ByteString                   (ByteString)
import qualified Data.ByteString.Lazy              as BL
import           Data.String
import qualified Data.Text as Text
import           Data.Text.Encoding
import           SolidVM.Model.Storable            hiding (size)
import           System.FilePath                   (takeFileName)
import           Text.Printf

-- | Inserts a Governance contract into the genesis block with the BlockApps root cert as owner
insertMercataGovernanceContract :: Address -> [Validator] -> [Address] -> GenesisInfo -> GenesisInfo
insertMercataGovernanceContract owner validators admins gi =
  gi
    { genesisInfoAddressInfo = initialAccounts ++ [govLogicAcct, govStorageAcct],
      genesisInfoCodeInfo = initialCode ++ [CodeInfo governanceSrc (Just "MercataGovernance")]
    }
  where
    initialAccounts = genesisInfoAddressInfo gi
    initialCode = genesisInfoCodeInfo gi

    governanceSrc = decodeUtf8 mercataGovernanceContract

    valIx = zip [0 ..] validators
    adminIx = zip [0 ..] admins
    govLogicAddr = 0xff
    govLogicAcct =
      SolidVMContractWithStorage
        govLogicAddr
        0
        (SolidVMCode "MercataGovernance" (KECCAK256.hash mercataGovernanceContract))
        []
    govStorageAcct =
      SolidVMContractWithStorage
        0x100
        0
        (SolidVMCode "Proxy" (KECCAK256.hash mercataGovernanceContract))
        $ [ ("._owner", BAddress owner)
          , (".validators.length", BInteger . toInteger $ length validators)
          , (".admins.length", BInteger . toInteger $ length admins)
          , (".logicContract", BAddress govLogicAddr)
          ]
          ++ concatMap
            ( \case
                (i, Validator c) ->
                  [ ( fromString $ ".validatorMap[" ++ printf "%040x" c ++ "]"
                    , BInteger $ i + 1
                    )
                  , ( fromString $ ".validators[" ++ show i ++ "]"
                    , BAddress c
                    )
                  ]
            )
            valIx
          ++ concatMap
            ( \case
                (i, c) ->
                  [ ( fromString $ ".adminMap[" ++ printf "%040x" c ++ "]"
                    , BInteger $ i + 1
                    )
                  , ( fromString $ ".admins[" ++ show i ++ "]"
                    , BAddress c
                    )
                  ]
            )
            adminIx

embeddedFiles :: [(FilePath, ByteString)]
embeddedFiles = $(typecheckAndEmbedFiles "resources"
  [ "contracts/abstract/ERC20/access/Authorizable.sol"
  , "contracts/abstract/ERC20/access/Ownable.sol"
  , "contracts/abstract/ERC20/utils/Context.sol"
  , "contracts/concrete/Admin/AdminRegistry.sol"
  , "contracts/concrete/Proxy/Proxy.sol"
  , "strato/MercataGovernance.sol"
  ])

mercataGovernanceContracts :: [[String]]
mercataGovernanceContracts = map (\(fp, bs) -> [takeFileName fp, Text.unpack $ decodeUtf8 bs]) embeddedFiles

mercataGovernanceContract :: ByteString
mercataGovernanceContract = BL.toStrict $ JSON.encode mercataGovernanceContracts
