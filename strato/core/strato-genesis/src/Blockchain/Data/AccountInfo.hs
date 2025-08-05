{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

module Blockchain.Data.AccountInfo
  ( AccountInfo (..),
    accountExtractor,
    acctInfoAddress
  )
where

import Blockchain.Data.RLP
import Blockchain.MiscJSON ()
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.CodePtr
import Blockchain.Strato.Model.ExtendedWord
import Control.Applicative (many)

import Data.Aeson
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import qualified Data.JsonStream.Parser as JS
--import Data.Swagger hiding (Format, format, name)
import qualified Data.Vector as V
import SolidVM.Model.Storable
import Text.Format
import Text.Tools

data AccountInfo
  = NonContract Address Integer
  | ContractNoStorage Address Integer CodePtr
  | ContractWithStorage Address Integer CodePtr [(Word256, Word256)]
  | SolidVMContractWithStorage Address Integer CodePtr [(B.ByteString, BasicValue)]
  deriving (Show, Eq, Read)

acctInfoAddress :: AccountInfo ->  Address
acctInfoAddress (NonContract a _) = a
acctInfoAddress (ContractNoStorage a _ _) = a
acctInfoAddress (ContractWithStorage a _ _ _) = a
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
  format (ContractWithStorage addr nonce ch s) =
    unlines
      [ "AccountInfo - ContractWithStorage",
        "-------------------------",
        tab' $ "Address:   " ++ format addr,
        tab' $ "Nonce:     " ++ show nonce,
        tab' $ "Code hash: " ++ format ch,
        tab' $ "Storage:   " ++ show s
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
  parseJSON (Array v) = do
    -- (a':i':xs)

    let (a', i', xs) = case V.toList v of (a : i : xs') -> (a, i, xs'); _ -> error "parseJSON for AccountInfo as an Array failed"

    a <- parseJSON a'
    i <- parseJSON i'
    case xs of
      [] -> return $ NonContract a i
      (c' : s') -> do
        c <- parseJSON c'
        case s' of
          [] -> return $ ContractNoStorage a i c
          [x] -> do
            s <- parseJSON x
            return $ ContractWithStorage a i c s
          _ -> error "parseJSON for AccountInfo as an Array failed"
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
            return $ SolidVMContractWithStorage a b c (map (\(k, v) -> (BC.pack k, v)) s)
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
  toJSON (ContractWithStorage a b c s) =
    object
      [ "address" .= a,
        "balance" .= b,
        "codeHash" .= c,
        "storage" .= s
      ]
  toJSON (SolidVMContractWithStorage a b c s) =
    object
      [ "address" .= a,
        "balance" .= b,
        "codeHash" .= c,
        "storage" .= map (\(k, v) -> (BC.unpack k, v)) s
      ]

instance RLPSerializable AccountInfo where
  rlpEncode (NonContract a b) = RLPArray [rlpEncode a, rlpEncode b]
  rlpEncode (ContractNoStorage a b c) = RLPArray [rlpEncode a, rlpEncode b, rlpEncode c]
  rlpEncode (ContractWithStorage a b c d) = RLPArray [rlpEncode a, rlpEncode b, rlpEncode c, RLPArray $ map rlpEncode d]
  rlpEncode (SolidVMContractWithStorage a b c d) = RLPArray [rlpEncode a, rlpEncode b, rlpEncode c, RLPArray $ map rlpEncode d]

  rlpDecode (RLPArray [a, b, c, RLPArray d]) = ContractWithStorage (rlpDecode a) (rlpDecode b) (rlpDecode c) (map rlpDecode d)
  rlpDecode (RLPArray [a, b, c]) = ContractNoStorage (rlpDecode a) (rlpDecode b) (rlpDecode c)
  rlpDecode (RLPArray [a, b]) = NonContract (rlpDecode a) (rlpDecode b)
  rlpDecode _ = error ("Error in rlpDecode for AccountInfo: bad RLPObject")
{-
instance Arbitrary AccountInfo where
  arbitrary =
    NonContract
      <$> arbitrary
      <*> arbitrary `suchThat` (>= 0)

instance ToSchema CodeInfo where
  declareNamedSchema _ =
    return $
      NamedSchema
        (Just "CodeInfo")
        (mempty)

instance ToSchema AccountInfo where
  declareNamedSchema _ = return $ NamedSchema (Just "AccountInfo") byteSchema
-}
accountExtractor :: JS.Parser [AccountInfo]
accountExtractor = many ("accountInfo" JS..: JS.arrayOf acctInfo)

acctInfo :: JS.Parser AccountInfo
acctInfo = JS.value
