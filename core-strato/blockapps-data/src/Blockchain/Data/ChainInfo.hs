{-# OPTIONS -fno-warn-missing-methods #-}
{-# OPTIONS -fno-warn-orphans         #-}
{-# LANGUAGE DataKinds                #-}
{-# LANGUAGE DeriveGeneric            #-}
{-# LANGUAGE FlexibleInstances        #-}
{-# LANGUAGE OverloadedStrings        #-}
{-# LANGUAGE ScopedTypeVariables      #-}

module Blockchain.Data.ChainInfo
  ( ChainInfo (..),
    AccountInfo (..),
    CodeInfo (..),
    accountExtractor
  ) where


import           Control.Applicative               (many)

import           Blockchain.ExtWord
import           Blockchain.Data.Enode
import           Blockchain.Data.RLP
import           Blockchain.MiscJSON()
import           Blockchain.SHA
import           Blockchain.Strato.Model.Address
import           Blockchain.TypeLits

import           Data.Aeson
import qualified Data.ByteString                      as B
import qualified Data.JsonStream.Parser               as JS
import qualified Data.Map                             as M      hiding (map, filter)
import qualified Data.Text                            as T
import           Data.Text.Encoding                   (encodeUtf8, decodeUtf8)

import qualified GHC.Generics                         as GHCG


data CodeInfo = CodeInfo
  { codeInfoCode   :: B.ByteString
  , codeInfoSource :: String
  , codeInfoName   :: String
  } deriving (Show, Read, Eq, GHCG.Generic)

$(AT.deriveJSON defaultOptions{sumEncoding = AT.UntaggedValue} ''CodeInfo)

instance RLPSerializable CodeInfo where
  rlpEncode (CodeInfo a b c) = 
    RLPArray [rlpEncode a, rlpEncode b, rlpEncode c]
  rlpDecode (RLPArray [a,b,c]) = CodeInfo (rlpDecode a) (rlpDecode b) (rlpDecode c)
  rlpDecode _ = error ("Error in rlpDecode for CodeInfo: bad RLPObject") 

data AccountInfo = NonContract Address Integer
                 | ContractNoStorage Address Integer SHA
                 | ContractWithStorage Address Integer SHA [(Word256, Word256)]
   deriving (Show, Eq, Read, GHCG.Generic)

$(AT.deriveJSON defaultOptions{sumEncoding = AT.UntaggedValue} ''AccountInfo)

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
    accountInfo     :: [AccountInfo],
    codeInfo        :: [CodeInfo],
    members         :: M.Map Address Enode
} deriving (Eq, Show, Read, GHCG.Generic)

instance FromJSON ChainInfo where
  parseJSON (Object o) = do
    l <- o .: "label"
    as <- o .: "accountInfo"
    cs <- o .: "codeInfo"
    ms <- ((o .: "members") :: NamedMapParser "address" Address "enode" Enode)
    return $ ChainInfo l as cs (M.fromList $ map toTuple ms)
  parseJSON x = error $ "couldn't parse JSON for chain info: " ++ show x

instance ToJSON ChainInfo where
  toJSON (ChainInfo cl ai ci ms) =
    object [ "label" .= cl
           , "accountInfo" .= ai
           , "codeInfo" .= ci
           , "members" .= ((map fromTuple (M.toList ms)) :: NamedMap "address" Address "enode" Enode)
           ]

instance KnownSymbol "address" where
instance KnownSymbol "enodeURL" where

instance RLPSerializable ChainInfo where
  rlpEncode ci = RLPArray
    [ rlpEncode . encodeUtf8 . T.pack $ chainLabel ci
    , RLPArray . map rlpEncode $ accountInfo ci
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
accountExtractor = many ("accountInfo" JS..: JS.arrayOf acctInfo)

acctInfo :: JS.Parser AccountInfo
acctInfo = JS.value
