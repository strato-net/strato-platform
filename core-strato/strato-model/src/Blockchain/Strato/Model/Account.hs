{-# LANGUAGE DataKinds                  #-}
{-# LANGUAGE DeriveDataTypeable         #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedLists       #-}
{-# LANGUAGE OverloadedStrings          #-}
{-# LANGUAGE QuasiQuotes                #-}
{-# LANGUAGE TemplateHaskell            #-}
{-# LANGUAGE TupleSections #-}

module Blockchain.Strato.Model.Account
    ( Account(..)
    , accountChainId
    , accountAddress
    , OnNamedChain(..)
    , NamedAccount(..)
    , namedAccountChainId
    , namedAccountAddress
    , namedAccountToAccount
    , accountToNamedAccount
    , accountOnUnspecifiedChain
    , unspecifiedChain
    , mainChain
    , explicitChain
    ) where

import           Control.DeepSeq
import           Control.Lens
import           Control.Monad                        ((<=<))
import qualified Data.Aeson                           as AS
import           Data.Aeson.Types
import qualified Data.Aeson.Encoding                  as Enc
import           Data.Binary
import           Data.Data
import           Data.Hashable
import           Data.Maybe                           (maybeToList)
import           Data.Swagger                         hiding (Format, format, get, put)
import qualified Data.Swagger                         as Sw
import qualified Data.Text                            as T
import           Database.Persist.Sql                 hiding (get)
import           GHC.Generics
import           Network.Haskoin.Crypto               hiding (Address, Word160)
import           Servant.API
import           Servant.Docs
import qualified Text.PrettyPrint.ANSI.Leijen         as Lei
import           Text.Printf
import           Test.QuickCheck                      (Arbitrary(..), oneof)
import           Web.FormUrlEncoded

import           Blockchain.Data.RLP
import           Blockchain.Strato.Model.Address
import qualified Data.RLP                             as RLP2
import qualified Text.Colors       as CL
import           Text.Format
import           Text.Read (readEither, readMaybe)
import           Text.ShortDescription


data Account = Account
  { _accountAddress :: Address
  , _accountChainId :: Maybe Word256
  } deriving (Eq, Ord, Generic, Data, Hashable, Binary)

makeLenses ''Account

instance RLPSerializable Account where
  rlpEncode = rlpEncode . show
  rlpDecode = read . rlpDecode

instance Show Account where
  show (Account a Nothing) = printf "%040x" a
  show (Account a (Just cid)) = (printf "%040x" a) ++ ":" ++ (printf "%064x" (toInteger cid))

instance Read Account where
  readsPrec _ s = case T.split (==':') (T.pack s) of
    [_] -> fmap (,"") . maybeToList $ flip Account Nothing <$> stringAddress s
    [addr, cid] -> fmap (,"") . maybeToList $ Account
      <$> (stringAddress $ T.unpack addr)
      <*> (Just . fromInteger <$> readMaybe ("0x" ++ T.unpack cid))
    _ -> []

{-
 make into a string rather than an object
-}
instance AS.ToJSON Account where
  toJSON = String . T.pack . show

instance AS.ToJSONKey Account where
  toJSONKey = ToJSONKeyText f (Enc.text . f)
          where f = T.pack . show

instance AS.FromJSON Account where
  parseJSON (String s) = case readMaybe (T.unpack s) of
    Nothing -> typeMismatch "Account" (String s)
    Just a -> pure a
  parseJSON x = typeMismatch "Account" x

instance FromJSONKey Account where
  fromJSONKey = FromJSONKeyTextParser (parseJSON . String)

instance Lei.Pretty Account where
  pretty = Lei.text . CL.yellow . show

instance Format Account where
  format = CL.yellow . show

instance ShortDescription Account where
  shortDescription = CL.yellow . show

fromJSONEither :: AS.FromJSON a => AS.Value -> Either T.Text a
fromJSONEither v = case AS.fromJSON v of
    AS.Error s -> Left (T.pack s)
    AS.Success a -> Right a

instance PersistField Account where
  toPersistValue = PersistText . T.pack . show
  fromPersistValue (PersistText t) = fromJSONEither $ String t
  fromPersistValue x = Left . T.pack $ "PersistField Account: expected PersistText: " ++ show x

instance PersistFieldSql Account where
  sqlType _ = SqlOther "text"
--  sqlType _ = SqlOther "varchar(64)"

------------------------------------

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

instance RLP2.RLPEncodable Account where
  rlpEncode = RLP2.rlpEncode . show
  rlpDecode = readEither <=< RLP2.rlpDecode

instance ToCapture (Capture "userAccount" Account) where
  toCapture _ = DocCapture "userAccount" "a STRATO account"

instance ToParamSchema Account where
  toParamSchema _ = mempty
    & type_ ?~ SwaggerString
    & Sw.format ?~ "hex string"

instance ToSchema Account where
  declareNamedSchema _ = return $
    NamedSchema (Just "Account")
      ( mempty
        & type_ ?~ SwaggerString
        & example ?~ "account=abcdef:deadbeef"
        & description ?~ "STRATO Account, 32 byte hex encoded chain ID, followed by a 20 byte hex encoded address" )

instance ToHttpApiData Account where
  toUrlPiece = T.pack . show

instance NFData Account

instance Arbitrary Account where
  arbitrary = Account <$> arbitrary <*> arbitrary

data OnNamedChain a = UnspecifiedChain | MainChain | ExplicitChain a
  deriving (Read, Eq, Ord, Generic, Data, Hashable, Binary)

data NamedAccount = NamedAccount
  { _namedAccountAddress :: Address
  , _namedAccountChainId :: OnNamedChain Word256
  } deriving (Eq, Ord, Generic, Data, Hashable, Binary)

makeLenses ''NamedAccount

namedAccountToAccount :: Maybe Word256 -> NamedAccount -> Account
namedAccountToAccount cid (NamedAccount a UnspecifiedChain)    = Account a cid
namedAccountToAccount _   (NamedAccount a MainChain)           = Account a Nothing
namedAccountToAccount _   (NamedAccount a (ExplicitChain cid)) = Account a (Just cid)

accountToNamedAccount :: Maybe Word256 -> Account -> NamedAccount
accountToNamedAccount c (Account a c') | c == c'   = NamedAccount a UnspecifiedChain
                                       | otherwise = NamedAccount a (maybe MainChain ExplicitChain c')

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
  readsPrec _ s = case T.split (==':') (T.pack s) of
    [_] -> fmap (,"") . maybeToList $ flip NamedAccount UnspecifiedChain <$> stringAddress s
    [addr, cid] -> fmap (,"") . maybeToList $ NamedAccount
      <$> (stringAddress $ T.unpack addr)
      <*> (case cid of
             "main" -> Just MainChain
             _ -> ExplicitChain . fromInteger <$> readMaybe ("0x" ++ T.unpack cid))
    _ -> []

instance RLPSerializable NamedAccount where
  rlpEncode = rlpEncode . show
  rlpDecode = read . rlpDecode

{-
 make into a string rather than an object
-}
instance AS.ToJSON NamedAccount where
  toJSON = String . T.pack . show

instance AS.ToJSONKey NamedAccount where
  toJSONKey = ToJSONKeyText f (Enc.text . f)
          where f = T.pack . show

instance AS.FromJSON NamedAccount where
  parseJSON (String s) = case readMaybe (T.unpack s) of
    Nothing -> typeMismatch "NamedAccount" (String s)
    Just a -> pure a
  parseJSON x = typeMismatch "NamedAccount" x

instance FromJSONKey NamedAccount where
  fromJSONKey = FromJSONKeyTextParser (parseJSON . String)

instance Lei.Pretty NamedAccount where
  pretty = Lei.text . CL.yellow . show

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
