{-# LANGUAGE DataKinds                  #-}
{-# LANGUAGE DeriveDataTypeable         #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE OverloadedLists       #-}
{-# LANGUAGE OverloadedStrings          #-}
{-# LANGUAGE QuasiQuotes                #-}
{-# LANGUAGE TemplateHaskell            #-}

module Blockchain.Strato.Model.Account
    ( Account(..)
    , accountChainId
    , accountAddress
    ) where

import           Control.DeepSeq
import           Control.Lens
import qualified Data.Aeson                           as AS
import           Data.Aeson.Types
import qualified Data.Aeson.Encoding                  as Enc
import           Data.Binary
import           Data.Data
import           Data.Hashable
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
import           Test.QuickCheck                      (Arbitrary(..))
import           Web.FormUrlEncoded

import           Blockchain.Data.RLP
import           Blockchain.Strato.Model.Address
import qualified Data.RLP                             as RLP2
import qualified Text.Colors       as CL
import           Text.Format
import           Text.ShortDescription


data Account = Account
  { _accountAddress :: Address
  , _accountChainId :: Maybe Word256
  } deriving (Eq, Ord, Generic, Data, Hashable)

makeLenses ''Account

instance RLPSerializable Account where
  rlpEncode (Account a Nothing) = rlpEncode a
  rlpEncode (Account a (Just cid)) = RLPArray [rlpEncode a, rlpEncode cid]
  rlpDecode r@(RLPString _) = Account (rlpDecode r) Nothing
  rlpDecode (RLPArray [a, cid]) = Account (rlpDecode a) (rlpDecode cid)
  rlpDecode x = error ("rlpDecode Account: " ++ show x)

instance Show Account where
  show (Account a Nothing) = printf "%040x" a
  show (Account a (Just cid)) = (printf "%040x" a) ++ ":" ++ (printf "%064x" (toInteger cid))

{-
 make into a string rather than an object
-}
instance AS.ToJSON Account where
  toJSON = String . T.pack . show

instance AS.ToJSONKey Account where
  toJSONKey = ToJSONKeyText f (Enc.text . f)
          where f = T.pack . show

instance AS.FromJSON Account where
  parseJSON (String s) = case T.split (==':') s of
    [_] -> flip Account Nothing <$> parseJSON (String s)
    [addr, cid] -> Account  <$> (parseJSON $ String addr) <*> (Just <$> parseJSON (String cid))
    _ -> typeMismatch "Account" (String s)
  parseJSON x = typeMismatch "Account" x

instance FromJSONKey Account where
  fromJSONKey = FromJSONKeyTextParser (parseJSON . String)

instance Lei.Pretty Account where
  pretty = Lei.text . CL.yellow . show

instance Format Account where
  format = CL.yellow . show

instance ShortDescription Account where
  shortDescription = CL.yellow . show

instance Binary Account where

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
  rlpEncode (Account addr Nothing) = RLP2.rlpEncode addr
  rlpEncode (Account addr (Just cid)) = RLP2.Array [RLP2.rlpEncode addr, RLP2.rlpEncode cid]
  rlpDecode (RLP2.Array [addr, cid]) = Account <$> RLP2.rlpDecode addr <*> (Just <$> RLP2.rlpDecode cid)
  rlpDecode obj = flip Account Nothing <$> RLP2.rlpDecode obj

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

