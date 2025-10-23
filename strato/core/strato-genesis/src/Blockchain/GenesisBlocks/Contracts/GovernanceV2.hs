{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}

module Blockchain.GenesisBlocks.Contracts.GovernanceV2 (
  insertMercataGovernanceContract
  ) where

import Blockchain.Data.GenesisInfo
import Blockchain.GenesisBlocks.Contracts.TH
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.CodePtr
import qualified Blockchain.Strato.Model.Keccak256 as KECCAK256
import Blockchain.Strato.Model.Validator
import           Data.ByteString                   (ByteString)
import           Data.Map                          (Map)
import qualified Data.Map                          as Map
import           Data.Maybe
import           Data.String
import           Data.Text.Encoding
import           SolidVM.Model.Storable hiding (size)
import           Text.Printf

adminRegistryAddress :: Address
adminRegistryAddress = 0x100c

-- | Inserts a Governance contract into the genesis block with the BlockApps root cert as owner
insertMercataGovernanceContract :: [Validator] -> [Address] -> GenesisInfo -> GenesisInfo
insertMercataGovernanceContract validators admins gi =
  gi
    { genesisInfoAccountInfo = initialAccounts ++ [govAcct],
      genesisInfoCodeInfo = initialCode ++ [CodeInfo governanceSrc (Just "MercataGovernance")]
    }
  where
    initialAccounts = genesisInfoAccountInfo gi
    initialCode = genesisInfoCodeInfo gi

    governanceSrc = decodeUtf8 mercataGovernanceContract

    valIx = zip [0 ..] validators
    adminIx = zip [0 ..] admins
    govAcct =
      SolidVMContractWithStorage
        0x100
        0x426c6f636b61707073205374617274696e6672042616c616e6365
        (SolidVMCode "MercataGovernance" (KECCAK256.hash mercataGovernanceContract))
        $ [ (".owner", BAccount $ NamedAccount adminRegistryAddress UnspecifiedChain),
            (".validators.length", BInteger . toInteger $ length validators),
            (".admins.length", BInteger . toInteger $ length admins)
          ]
          -- ++ map (\(i, CommonName o u c True) ->
          --          ( encodeUtf8 $ ".validatorMap[" <> o <> "][" <> u <> "][" <> c <> "]"
          --          , addrToCertIdx . show $ validatorAddr i)) valIx
          -- ++ map (\(i, CommonName o u c True) ->
          --          ( encodeUtf8 $ ".adminMap[" <> o <> "][" <> u <> "][" <> c <> "]"
          --          , addrToCertIdx . show $ adminAddr i)) adminIx
          ++ concatMap
            ( \case
                (i, Validator c) ->
                  [ ( fromString $ ".validatorMap[" ++ printf "%040x" c ++ "]"
                    , BInteger $ i + 1
                    )
                  , ( fromString $ ".validators[" ++ show i ++ "]"
                    , BAccount (NamedAccount c UnspecifiedChain)
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
                    , BAccount (NamedAccount c UnspecifiedChain)
                    )
                  ]
            )
            adminIx

governanceFilePath :: FilePath
governanceFilePath = "MercataGovernance.sol"

embeddedFiles :: [(FilePath, ByteString)]
embeddedFiles = $(typecheckAndEmbedDir "resources/strato/governance" Nothing)

fileMap :: Map FilePath ByteString
fileMap = Map.fromList embeddedFiles

fileContents :: FilePath -> ByteString
fileContents = fromJust . flip Map.lookup fileMap

mercataGovernanceContract :: ByteString
mercataGovernanceContract = fileContents governanceFilePath
