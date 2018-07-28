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
import           Blockchain.Data.Enode
import           Blockchain.Data.RLP
import           Blockchain.MiscJSON()
import           Blockchain.SHA
import           Blockchain.Strato.Model.Address
-- import           Blockchain.TypeLits

import           Data.Aeson
import qualified Data.ByteString                      as B
import qualified Data.JsonStream.Parser               as JS
import qualified Data.Map                             as M
import qualified Data.Text                            as T
import           Data.Text.Encoding                   (encodeUtf8, decodeUtf8)

import qualified GHC.Generics                         as GHCG


data CodeInfo = CodeInfo
  { codeInfoCode   :: B.ByteString
  , codeInfoSource :: String
  , codeInfoName   :: String
  } deriving (Show, Read, Eq, GHCG.Generic)

instance FromJSON CodeInfo where
  parseJSON (Object o) =
    CodeInfo
    <$> o .: "code"
    <*> o .: "src"
    <*> o .: "name"
  parseJSON _ = error "parseJSON CodeInfo: expected Object"

instance ToJSON CodeInfo where
  toJSON (CodeInfo bs s1 s2) = object
    [ "code" .= bs
    , "src"  .= s1
    , "name" .= s2
    ]

instance RLPSerializable CodeInfo where
  rlpEncode (CodeInfo a b c) = 
    RLPArray [rlpEncode a, rlpEncode b, rlpEncode c]
  rlpDecode (RLPArray [a,b,c]) = CodeInfo (rlpDecode a) (rlpDecode b) (rlpDecode c)
  rlpDecode _ = error ("Error in rlpDecode for CodeInfo: bad RLPObject") 


data AccountInfo = NonContract Address Integer
                 | ContractNoStorage Address Integer SHA
                 | ContractWithStorage Address Integer SHA [(Word256, Word256)]
   deriving (Show, Eq, Read, GHCG.Generic)

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
            return $ ContractWithStorage a b c s
  parseJSON o = error $ "parseJSON AccountInfo: Expected object, got: " ++ show o

instance ToJSON AccountInfo where
  toJSON (NonContract a b) = object
    [ "address" .= a
    , "balance" .= b
    ]
  toJSON (ContractNoStorage a b c) = object
    [ "address" .= a
    , "balance" .= b
    , "codeHash" .= c
    ]
  toJSON (ContractWithStorage a b c s) = object
    [ "address" .= a
    , "balance" .= b
    , "codeHash" .= c
    , "storage" .= s
    ]

instance RLPSerializable AccountInfo where
  rlpEncode (NonContract a b) = RLPArray [rlpEncode a, rlpEncode b]
  rlpEncode (ContractNoStorage a b c) = RLPArray [rlpEncode a, rlpEncode b, rlpEncode c]
  rlpEncode (ContractWithStorage a b c d) = RLPArray [rlpEncode a, rlpEncode b, rlpEncode c, RLPArray $ rlpEncode <$> d]

  rlpDecode (RLPArray [a,b,c, RLPArray d]) = ContractWithStorage (rlpDecode a) (rlpDecode b) (rlpDecode c) (rlpDecode <$> d)
  rlpDecode (RLPArray [a,b,c]) = ContractNoStorage (rlpDecode a) (rlpDecode b) (rlpDecode c)
  rlpDecode (RLPArray [a,b]) = NonContract (rlpDecode a) (rlpDecode b)
  rlpDecode _ = error ("Error in rlpDecode for AccountInfo: bad RLPObject")


data ChainInfo = ChainInfo {
    chainLabel      :: String,
    acctInfo        :: [AccountInfo],
    codeInfo        :: [CodeInfo],
    members         :: M.Map Address Enode
} deriving (Eq, Show, Read, GHCG.Generic)

instance FromJSON ChainInfo where
  parseJSON (Object o) = do
    cl <- (o .: "label")
    ai <- (o .: "acctInfo")
    ci <- (o .: "codeInfo")
    mb <- (o .: "members") 
    return $ ChainInfo cl ai ci (M.fromList mb)
  parseJSON x = error $ "couldn't parse JSON for chain info: " ++ show x

instance ToJSON ChainInfo where
  toJSON (ChainInfo cl ai ci ms) =
    object [ "label" .= cl
           , "acctInfo" .= ai
           , "codeInfo" .= ci
           , "members" .= (M.toList ms)
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
