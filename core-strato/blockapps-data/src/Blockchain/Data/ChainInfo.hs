{-# OPTIONS -fno-warn-missing-methods #-}
{-# OPTIONS -fno-warn-orphans         #-}
{-# LANGUAGE DataKinds                #-}
{-# LANGUAGE DeriveGeneric            #-}
{-# LANGUAGE FlexibleInstances        #-}
{-# LANGUAGE OverloadedStrings        #-}

module Blockchain.Data.ChainInfo
  ( ChainInfo (..),
    AccountInfo (..),
    CodeInfo (..),
    accountInfo,
    accountExtractor
  ) where


import           Control.Applicative               (many)

import           Blockchain.ExtWord
import           Blockchain.Data.ArbitraryInstances()
import           Blockchain.Data.Enode
import           Blockchain.Data.RLP
import           Blockchain.SHA
import           Blockchain.Strato.Model.Address
-- import           Blockchain.TypeLits

import           Data.Aeson
import           Data.Aeson.TH                        as AT
import qualified Data.ByteString                      as B
import qualified Data.JsonStream.Parser               as JS
import qualified Data.Map                             as M
import qualified Data.Text                            as T
import           Data.Text.Encoding                   (encodeUtf8, decodeUtf8)

import qualified GHC.Generics                         as GHCG

import           Test.QuickCheck.Arbitrary


data CodeInfo = CodeInfo B.ByteString String String
  deriving (Show, Read, Eq, GHCG.Generic)

$(deriveJSON defaultOptions{sumEncoding = AT.UntaggedValue} ''CodeInfo)

instance RLPSerializable CodeInfo where
  rlpEncode (CodeInfo a b c) = 
    RLPArray [rlpEncode a, rlpEncode b, rlpEncode c]
  rlpDecode (RLPArray [a,b,c]) = CodeInfo (rlpDecode a) (rlpDecode b) (rlpDecode c)
  rlpDecode _ = error ("Error in rlpDecode for CodeInfo: bad RLPObject") 

instance Arbitrary CodeInfo where
  arbitrary = CodeInfo 
      <$> arbitrary
      <*> arbitrary
      <*> arbitrary

data AccountInfo = NonContract Address Integer
                 | ContractNoStorage Address Integer SHA
                 | ContractWithStorage Address Integer SHA [(Word256, Word256)]
  deriving (Show, Read, Eq)

$(deriveJSON defaultOptions{sumEncoding = AT.UntaggedValue} ''AccountInfo)

instance RLPSerializable AccountInfo where
  rlpEncode (NonContract a b) = RLPArray [rlpEncode a, rlpEncode b]
  rlpEncode (ContractNoStorage a b c) = RLPArray [rlpEncode a, rlpEncode b, rlpEncode c]
  rlpEncode (ContractWithStorage a b c d) = RLPArray [rlpEncode a, rlpEncode b, rlpEncode c, RLPArray (rlpEncode <$> d)]

  rlpDecode (RLPArray [a,b]) = NonContract (rlpDecode a) (rlpDecode b)
  rlpDecode (RLPArray [a,b,c]) = ContractNoStorage (rlpDecode a) (rlpDecode b) (rlpDecode c)
  rlpDecode (RLPArray [a,b,c, RLPArray d]) = ContractWithStorage (rlpDecode a) (rlpDecode b) (rlpDecode c) (rlpDecode <$> d)
  rlpDecode _ = error ("Error in rlpDecode for AccountInfo: bad RLPObject")

instance Arbitrary AccountInfo where
  arbitrary = NonContract
      <$> arbitrary
      <*> arbitrary

data ChainInfo = ChainInfo {
    chainLabel      :: String,
    acctInfo        :: [AccountInfo],
    codeInfo        :: [CodeInfo],
    members         :: M.Map Address Enode
} deriving (Eq, Read, Show, GHCG.Generic)

instance Arbitrary ChainInfo where
  arbitrary = ChainInfo
          <$> arbitrary
          <*> arbitrary
          <*> arbitrary
          <*> arbitrary
          <*> (do
                  array <- arbitrary
                  return $ map (\(a,b) -> (a, abs b)) array
              )

instance FromJSON ChainInfo where
  parseJSON (Object o) =
    ChainInfo <$>
    o .: "label" <*>
    o .: "acctInfo" <*>
    o .: "codeInfo" <*>
    o .: "members" 
  parseJSON x = error $ "couldn't parse JSON for chain info: " ++ show x

instance ToJSON ChainInfo where
  toJSON (ChainInfo cl ai ci ms) =
    object [ "label" .= cl
           , "acctInfo" .= ai
           , "codeInfo" .= ci
           , "members" .= ms
           ]

instance RLPSerializable ChainInfo where
  rlpEncode ci = RLPArray
    [ rlpEncode . encodeUtf8 . T.pack $ chainLabel ci
    , RLPArray . map rlpEncode $ acctInfo ci
    , RLPArray . map rlpEncode $ codeInfo ci
    , rlpEncode $ members ci
    ]
  rlpDecode (RLPArray [cl, RLPArray ai, RLPArray coi, ms]) =
    ChainInfo
      (T.unpack . decodeUtf8 $ rlpDecode cl)
      (rlpDecode <$> ai)
      (rlpDecode <$> coi)
      (rlpDecode ms)
  rlpDecode o = error $ "rlpDecode ChainInfo: Expected 5 element RLPArray, got " ++ show o


accountExtractor :: JS.Parser [AccountInfo]
accountExtractor = many ("accountInfo" JS..: JS.arrayOf accountInfo)

accountInfo :: JS.Parser AccountInfo
accountInfo = JS.value

