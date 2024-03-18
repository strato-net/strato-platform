{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedLists #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}

module Blockchain.Strato.Model.Account
  ( Account (..),
    AccountPayable,
    accountChainId,
    accountAddress,
    OnNamedChain (..),
    NamedAccount (..),
    namedAccountChainId,
    namedAccountAddress,
    namedAccountToAccount,
    accountToNamedAccount,
    accountToNamedAccount',
    accountOnUnspecifiedChain,
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
import Data.Swagger hiding (Format, format, get, put)
import qualified Data.Swagger as Sw
import qualified Data.Text as T
import Database.Persist.TH
import GHC.Generics
import Servant.API
import Servant.Docs
import Test.QuickCheck (Arbitrary (..), oneof)
import qualified Text.Colors as CL
import Text.Format
import Text.Printf
import Text.Read (readMaybe)
import Text.ShortDescription
import Web.FormUrlEncoded

type AccountPayable = Account --type synonym, irrelevant at runtime, but matters for typechecking during complilation

data Account = Account
  { _accountAddress :: Address,
    _accountChainId :: Maybe Word256
  }
  deriving (Eq, Ord, Generic, Data, Hashable, Binary)

makeLenses ''Account

instance RLPSerializable Account where
  rlpEncode (Account a Nothing) = rlpEncode a
  rlpEncode (Account a (Just cid)) = RLPArray [rlpEncode a, rlpEncode cid]
  rlpDecode (RLPArray [a, cid]) = Account (rlpDecode a) (Just $ rlpDecode cid)
  rlpDecode a = Account (rlpDecode a) Nothing

instance Show Account where
  show (Account a Nothing) = printf "%040x" a
  show (Account a (Just cid)) = (printf "%040x" a) ++ ":" ++ (printf "%064x" (toInteger cid))

instance Read Account where
  readsPrec _ s = case span (/= ':') s of
    (mAddr, mRem) -> case stringAddress mAddr of
      Nothing -> []
      Just addr -> case mRem of
        (':' : rem') -> case splitAt 64 rem' of
          (mCid, mRem2) -> case fromInteger <$> readMaybe ("0x" ++ mCid) of
            Nothing -> [(Account addr Nothing, mRem)]
            Just cid -> [(Account addr (Just cid), mRem2)]
        _ -> [(Account addr Nothing, mRem)]

{-
 make into a string rather than an object
-}
instance AS.ToJSON Account where
  toJSON = String . T.pack . show

instance AS.ToJSONKey Account where
  toJSONKey = ToJSONKeyText f (Enc.text . t)
    where
      f = DAK.fromText . T.pack . show
      t = T.pack . show

instance AS.FromJSON Account where
  parseJSON (String s) = case readMaybe (T.unpack s) of
    Nothing -> typeMismatch "Account" (String s)
    Just a -> pure a
  parseJSON x = typeMismatch "Account" x

instance FromJSONKey Account where
  fromJSONKey = FromJSONKeyTextParser (parseJSON . String)

instance Format Account where
  format = CL.yellow . show

instance ShortDescription Account where
  shortDescription = CL.yellow . show

fromJSONEither :: AS.FromJSON a => AS.Value -> Either T.Text a
fromJSONEither v = case AS.fromJSON v of
  AS.Error s -> Left (T.pack s)
  AS.Success a -> Right a

derivePersistField "Account"

instance FromHttpApiData Account where
  parseQueryParam = fromJSONEither . String

instance ToForm Account where
  toForm account = [("account", toQueryParam account)]

instance FromForm Account where fromForm = parseUnique "account"

instance ToSample Account where
  toSamples _ = samples [Account 0xdeadbeef Nothing, Account 0x12345678 (Just 0xabcdef)]

instance ToCapture (Capture "account" Account) where
  toCapture _ = DocCapture "account" "a STRATO account"

instance ToCapture (Capture "contractAccount" Account) where
  toCapture _ = DocCapture "contractAccount" "a STRATO account"


instance ToCapture (Capture "userAccount" Account) where
  toCapture _ = DocCapture "userAccount" "a STRATO account"

instance ToParamSchema Account where
  toParamSchema _ =
    mempty
      & type_ ?~ SwaggerString
      & Sw.format ?~ "hex string"

instance ToSchema Account where
  declareNamedSchema _ =
    return $
      NamedSchema
        (Just "Account")
        ( mempty
            & type_ ?~ SwaggerString
            & example ?~ "account=abcdef:deadbeef"
            & description ?~ "STRATO Account, 32 byte hex encoded chain ID, followed by a 20 byte hex encoded address"
        )

instance ToHttpApiData Account where
  toUrlPiece = T.pack . show

instance NFData Account

instance Arbitrary Account where
  arbitrary = Account <$> arbitrary <*> arbitrary

data OnNamedChain a = UnspecifiedChain | MainChain | ExplicitChain a
  deriving (Read, Eq, Ord, Generic, Data, Hashable, Binary)

data NamedAccount = NamedAccount
  { _namedAccountAddress :: Address,
    _namedAccountChainId :: OnNamedChain Word256
  }
  deriving (Eq, Ord, Generic, Data, Hashable, Binary)

makeLenses ''NamedAccount

namedAccountToAccount :: Maybe Word256 -> NamedAccount -> Account
namedAccountToAccount cid (NamedAccount a UnspecifiedChain) = Account a cid
namedAccountToAccount _ (NamedAccount a MainChain) = Account a Nothing
namedAccountToAccount _ (NamedAccount a (ExplicitChain cid)) = Account a (Just cid)

accountToNamedAccount :: Maybe Word256 -> Account -> NamedAccount
accountToNamedAccount c (Account a c')
  | c == c' = NamedAccount a UnspecifiedChain
  | otherwise = NamedAccount a (maybe MainChain ExplicitChain c')

accountToNamedAccount' :: Account -> NamedAccount
accountToNamedAccount' (Account a Nothing) = NamedAccount a MainChain
accountToNamedAccount' (Account a (Just cid)) = NamedAccount a (ExplicitChain cid)

accountOnUnspecifiedChain :: Account -> NamedAccount
accountOnUnspecifiedChain (Account a _) = NamedAccount a UnspecifiedChain

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
    (mAddr, mRem) -> case stringAddress mAddr of
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
