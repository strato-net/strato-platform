{-# LANGUAGE OverloadedStrings #-}

module Blockchain.GenesisBlocks.Contracts.UserRegistry (
  insertUserRegistryContract
  ) where

import BlockApps.X509.Certificate
import Blockchain.Data.GenesisInfo
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.CodePtr
import qualified Blockchain.Strato.Model.Keccak256 as KECCAK256
import Blockchain.Strato.Model.UserRegistry
import Data.Maybe
import Data.String
import Data.Text.Encoding
import SolidVM.Model.Value



-- | Inserts a User Registry contract into the genesis block with the BlockApps root cert as owner
insertUserRegistryContract :: [X509Certificate] -> GenesisInfo -> GenesisInfo
insertUserRegistryContract certs gi =
  gi
    { genesisInfoAccountInfo = initialAccounts ++ [registryAcct, rootAcct] ++ userAccts,
      genesisInfoCodeInfo = initialCode ++ [CodeInfo userRegistryContract (Just "UserRegistry")]
    }
  where
    initialAccounts = genesisInfoAccountInfo gi
    initialCode = genesisInfoCodeInfo gi

    encodedRegistry = encodeUtf8 userRegistryContract

    rootSub = fromJust $ getCertSubject rootCert
    rootAcct =
      SolidVMContractWithStorage
        (deriveAddressWithSalt Nothing (subCommonName rootSub) Nothing (Just . show $ OrderedVals [SString $ subCommonName rootSub]))
        123
        (SolidVMCode "User" (KECCAK256.hash encodedRegistry))
        [ (".commonName", fromString $ subCommonName rootSub)
        ]

    userAccts =
      map
        ( \cert -> do
            let certSub' crt =
                  case getCertSubject crt of
                    Just s -> s
                    Nothing -> error "Certificate requires a subject"
                certSub = certSub' cert
            SolidVMContractWithStorage
              (deriveAddressWithSalt Nothing (subCommonName certSub) Nothing (Just . show $ OrderedVals [SString $ subCommonName certSub]))
              0
              (SolidVMCode "User" (KECCAK256.hash encodedRegistry))
              [ (".commonName", fromString $ subCommonName certSub)
              ]
        )
        certs

    registryAcct =
      SolidVMContractWithStorage
        0x720
        720
        (SolidVMCode "UserRegistry" (KECCAK256.hash encodedRegistry))
        $ []
