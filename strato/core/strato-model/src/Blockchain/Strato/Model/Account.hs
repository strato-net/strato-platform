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
  ( NamedAccount (..),
    namedAccountAddress,
    unspecifiedChain
  )
where

import Blockchain.Data.RLP
import Blockchain.Strato.Model.Address
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
import Test.QuickCheck (Arbitrary (..))
import qualified Text.Colors as CL
import Text.Format
import Text.Printf
import Text.Read (readMaybe)
import Text.ShortDescription


data NamedAccount = NamedAccount
  { _namedAccountAddress :: Address
  }
  deriving (Generic, Data, Binary)

makeLenses ''NamedAccount

deriving instance Eq NamedAccount
deriving instance Ord NamedAccount
deriving instance Hashable NamedAccount

unspecifiedChain :: Address -> NamedAccount
unspecifiedChain = NamedAccount

instance Show NamedAccount where
  show (NamedAccount a) = printf "%040x" a

instance Read NamedAccount where
  readsPrec _ s = 
    case readMaybe s of
      Nothing -> []
      Just addr -> [(NamedAccount addr, "")]

instance RLPSerializable NamedAccount where
  rlpEncode (NamedAccount a) = rlpEncode a
  rlpDecode a = NamedAccount $ rlpDecode a

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

instance NFData NamedAccount

instance Arbitrary NamedAccount where
  arbitrary = NamedAccount <$> arbitrary
