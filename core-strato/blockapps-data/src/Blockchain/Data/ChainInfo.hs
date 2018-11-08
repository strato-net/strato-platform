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
import qualified Data.ByteString.Base16               as B16
import qualified Data.ByteString.Char8                as C8
import qualified Data.JsonStream.Parser               as JS
import qualified Data.Map                             as M      hiding (map, filter)
import qualified Data.Text                            as T
import           Data.Text.Encoding                   (encodeUtf8, decodeUtf8)
import qualified Data.Vector                          as V

import qualified GHC.Generics                         as GHCG


data CodeInfo = CodeInfo
  { codeInfoCode   :: B.ByteString
  , codeInfoSource :: T.Text
  , codeInfoName   :: T.Text
  } deriving (Show, Read, Eq, GHCG.Generic)

instance FromJSON CodeInfo where
  parseJSON (Array v) = do
    let [a',b',c'] = V.toList v
    a <- parseJSON a'
    b <- parseJSON b'
    c <- parseJSON c'
    return (CodeInfo (fst . B16.decode $ C8.pack a) b c)

  parseJSON (Object o) =
    CodeInfo
    <$> ((fst . B16.decode . C8.pack) <$> (o .: "code"))
    <*> o .: "src"
    <*> o .: "name"

  parseJSON x = error $ "tried to parse JSON for " ++ show x ++ " as type CodeInfo"

instance ToJSON CodeInfo where
  toJSON (CodeInfo bs s1 s2) = object
    [ "code" .= (C8.unpack $ B16.encode bs)
    , "src"  .= s1
    , "name" .= s2
    ]

instance RLPSerializable CodeInfo where
  rlpEncode (CodeInfo a b c) =
    RLPArray [rlpEncode a, rlpEncode $ encodeUtf8 b, rlpEncode $ encodeUtf8 c]
  rlpDecode (RLPArray [a,b,c]) = CodeInfo (rlpDecode a) (decodeUtf8 $ rlpDecode b) (decodeUtf8 $ rlpDecode c)
  rlpDecode _ = error ("Error in rlpDecode for CodeInfo: bad RLPObject")

data AccountInfo = NonContract Address Integer
                 | ContractNoStorage Address Integer SHA
                 | ContractWithStorage Address Integer SHA [(Word256, Word256)]
   deriving (Show, Eq, Read, GHCG.Generic)

instance FromJSON AccountInfo where
  parseJSON (Array v) = do
    let (a':i':xs) = V.toList v
    a <- parseJSON a'
    i <- parseJSON i'
    case xs of
      [] -> return $ NonContract a i
      (c':s') -> do
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
            return $ ContractWithStorage a b c s

  parseJSON x = error $ "parseJSON failed for AccountInfo: " ++ show x


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
  rlpEncode (ContractWithStorage a b c d) = RLPArray [rlpEncode a, rlpEncode b, rlpEncode c, RLPArray $ map rlpEncode d]

  rlpDecode (RLPArray [a,b,c, RLPArray d]) = ContractWithStorage (rlpDecode a) (rlpDecode b) (rlpDecode c) (map rlpDecode d)
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
instance KnownSymbol "enode" where

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
  rlpDecode o = error $ "rlpDecode ChainInfo: Expected 4 element RLPArray, got " ++ show o


accountExtractor :: JS.Parser [AccountInfo]
accountExtractor = many ("accountInfo" JS..: JS.arrayOf acctInfo)

acctInfo :: JS.Parser AccountInfo
acctInfo = JS.value
