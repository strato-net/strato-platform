{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedLists #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE StandaloneDeriving #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}

module Blockchain.Strato.Model.Account
  ( OnNamedChain (..),
    NamedAccount (..),
    namedAccountChainId,
    namedAccountAddress,
    unspecifiedChain,
    mainChain,
    explicitChain,
  )
where

import Blockchain.Data.RLP
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ExtendedWord
import Control.DeepSeq
import Control.Lens
import qualified Data.Aeson as AS
import qualified Data.Aeson.Encoding as Enc
import qualified Data.Aeson.Key as DAK
import Data.Aeson.Types
import Data.Binary
import Data.Data
import Data.Hashable
import qualified Data.Text as T
import GHC.Generics
import Test.QuickCheck (Arbitrary (..), oneof)
import qualified Text.Colors as CL
import Text.Format
import Text.Printf
import Text.Read (readMaybe)
import Text.ShortDescription


data OnNamedChain a = UnspecifiedChain | MainChain | ExplicitChain a
  deriving (Read, Generic, Data, Binary)

data NamedAccount = NamedAccount
  { _namedAccountAddress :: Address,
    _namedAccountChainId :: OnNamedChain Word256
  }
  deriving (Generic, Data, Binary)

makeLenses ''NamedAccount

instance Eq (OnNamedChain Word256) where
  MainChain == MainChain = True
  MainChain == UnspecifiedChain = True
  UnspecifiedChain == MainChain = True
  UnspecifiedChain == UnspecifiedChain = True

  ExplicitChain v1 == ExplicitChain v2 = v1 == v2
  _ == _ = False

deriving instance Hashable (OnNamedChain Word256)
deriving instance Ord (OnNamedChain Word256)

deriving instance Eq NamedAccount
deriving instance Ord NamedAccount
deriving instance Hashable NamedAccount

unspecifiedChain :: Address -> NamedAccount
unspecifiedChain = flip NamedAccount UnspecifiedChain

mainChain :: Address -> NamedAccount
mainChain = flip NamedAccount MainChain

explicitChain :: Address -> Word256 -> NamedAccount
explicitChain a cid = NamedAccount a (ExplicitChain cid)

instance Show NamedAccount where
  show (NamedAccount a UnspecifiedChain) = printf "%040x" a
  show (NamedAccount a MainChain) = printf "%040x:main" a
  show (NamedAccount a (ExplicitChain cid)) = (printf "%040x" a) ++ ":" ++ (printf "%064x" (toInteger cid))

instance Read NamedAccount where
  readsPrec _ s = case span (/= ':') s of
    (mAddr, mRem) -> case readMaybe mAddr of
      Nothing -> []
      Just addr -> case mRem of
        (':' : rem') -> case rem' of
          ('m' : 'a' : 'i' : 'n' : rem'') -> [(NamedAccount addr MainChain, rem'')]
          _ -> case splitAt 64 rem' of
            (mCid, mRem2) -> case fromInteger <$> readMaybe ("0x" ++ mCid) of
              Nothing -> [(NamedAccount addr UnspecifiedChain, mRem)]
              Just cid -> [(NamedAccount addr (ExplicitChain cid), mRem2)]
        _ -> [(NamedAccount addr UnspecifiedChain, mRem)]

instance RLPSerializable NamedAccount where
  rlpEncode (NamedAccount a UnspecifiedChain) = rlpEncode a
  rlpEncode (NamedAccount a MainChain) = RLPArray [rlpEncode a]
  rlpEncode (NamedAccount a (ExplicitChain cid)) = RLPArray [rlpEncode a, rlpEncode cid]
  rlpDecode (RLPArray [a, cid]) = NamedAccount (rlpDecode a) (ExplicitChain $ rlpDecode cid)
  rlpDecode (RLPArray [a]) = NamedAccount (rlpDecode a) MainChain
  rlpDecode a = NamedAccount (rlpDecode a) UnspecifiedChain

{-
 make into a string rather than an object
-}
instance AS.ToJSON NamedAccount where
  toJSON = String . T.pack . show

instance AS.ToJSONKey NamedAccount where
  toJSONKey = ToJSONKeyText f (Enc.text . t)
    where
      f = DAK.fromText . T.pack . show
      t = T.pack . show

instance AS.FromJSON NamedAccount where
  parseJSON (String s) = case readMaybe (T.unpack s) of
    Nothing -> typeMismatch "NamedAccount" (String s)
    Just a -> pure a
  parseJSON x = typeMismatch "NamedAccount" x

instance FromJSONKey NamedAccount where
  fromJSONKey = FromJSONKeyTextParser (parseJSON . String)

instance Format NamedAccount where
  format = CL.yellow . show

instance ShortDescription NamedAccount where
  shortDescription = CL.yellow . show

instance NFData a => NFData (OnNamedChain a)

instance NFData NamedAccount

instance Arbitrary a => Arbitrary (OnNamedChain a) where
  arbitrary = oneof [pure UnspecifiedChain, pure MainChain, ExplicitChain <$> arbitrary]

instance Arbitrary NamedAccount where
  arbitrary = NamedAccount <$> arbitrary <*> arbitrary
