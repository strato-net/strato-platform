{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Data.AccountInfo
  ( AccountInfo (..),
    accountExtractor,
    acctInfoAddress
  )
where

import Blockchain.MiscJSON ()
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.CodePtr
import Control.Applicative (many)

import Data.Aeson
import qualified Data.JsonStream.Parser as JS
import SolidVM.Model.Storable
import Text.Format
import Text.Tools

data AccountInfo
  = NonContract Address Integer
  | ContractNoStorage Address Integer CodePtr
  | SolidVMContractWithStorage
      Address
      -- ^ Contract address on the blockchain
      Integer
      -- ^ Balance in wei
      CodePtr
      -- ^ Hash pointer to the compiled SolidVM bytecode
      [(StoragePath, BasicValue)]
      -- ^ Storage key-value pairs where keys are raw ByteStrings and values are
      -- BasicValue types from SolidVM.Model.Storable This differs from
      -- ContractWithStorage which uses (Word256, Word256) pairs for EVM storage
  deriving (Show, Eq, Read)

acctInfoAddress :: AccountInfo ->  Address
acctInfoAddress (NonContract a _) = a
acctInfoAddress (ContractNoStorage a _ _) = a
acctInfoAddress (SolidVMContractWithStorage a _ _ _) = a

instance Format AccountInfo where
  format (NonContract addr nonce) =
    unlines
      [ "AccountInfo - NonContract",
        "-------------------------",
        tab' $ "Address: " ++ format addr,
        tab' $ "Nonce:   " ++ show nonce
      ]
  format (ContractNoStorage addr nonce ch) =
    unlines
      [ "AccountInfo - ContractNoStorage",
        "-------------------------",
        tab' $ "Address:   " ++ format addr,
        tab' $ "Nonce:     " ++ show nonce,
        tab' $ "Code hash: " ++ format ch
      ]
  format (SolidVMContractWithStorage addr nonce ch s) =
    unlines
      [ "AccountInfo - SolidVMContractWithStorage",
        "-------------------------",
        tab' $ "Address:   " ++ format addr,
        tab' $ "Balance:     " ++ show nonce,
        tab' $ "Code hash: " ++ format ch,
        tab' $ "Storage:   " ++ show s
      ]

instance FromJSON AccountInfo where
  parseJSON (Object o) = do
    a <- (o .: "address")
    b <- (o .: "balance")
    mc <- (o .:? "codeHash")
    case mc of
      Nothing -> return $ NonContract a b
      Just c -> do
        ms <- (o .:? "storage")
        case ms of
          Nothing -> return $ ContractNoStorage a b c
          Just s -> do
            return $ SolidVMContractWithStorage a b c s
  parseJSON x = error $ "parseJSON failed for AccountInfo: " ++ show x

instance ToJSON AccountInfo where
  toJSON (NonContract a b) =
    object
      [ "address" .= a,
        "balance" .= b
      ]
  toJSON (ContractNoStorage a b c) =
    object
      [ "address" .= a,
        "balance" .= b,
        "codeHash" .= c
      ]
  toJSON (SolidVMContractWithStorage a b c s) =
    object
      [ "address" .= a,
        "balance" .= b,
        "codeHash" .= c,
        "storage" .= s
      ]

accountExtractor :: JS.Parser [AccountInfo]
accountExtractor = many ("accountInfo" JS..: JS.arrayOf acctInfo)

acctInfo :: JS.Parser AccountInfo
acctInfo = JS.value
