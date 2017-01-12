{-# LANGUAGE
    DeriveGeneric
  , OverloadedLists
  , OverloadedStrings
#-}

module BlockApps.Data
  ( -- * Addresses
    Address (..)
  , addressString
  , stringAddress
    -- * Keccak 256 Hashes
  , Keccak256 (..)
  , keccak256String
  , stringKeccak256
    -- * Account States
  , AccountState (..)
    -- * Transactions
  , Transaction (..)
    -- * Ethereum Types
  , Nonce (..)
  , Wei (..)
  , Gas (..)
  ) where

import Crypto.Secp256k1
import Data.Aeson
import Data.LargeWord
import Data.Monoid
import qualified Data.Text as Text
import GHC.Generics
import Numeric
import Test.QuickCheck
import Text.Read
import Web.FormUrlEncoded
import Web.HttpApiData

newtype Address = Address Word160 deriving (Eq,Show,Generic)
addressString :: Address -> String
addressString (Address address) = padZeros 20 (showHex address "")
stringAddress :: String -> Maybe Address
stringAddress string = Address . fromInteger <$> readMaybe ("0x" ++ string)
instance ToJSON Address where toJSON = toJSON . addressString
instance FromJSON Address where
  parseJSON value = do
    string <- parseJSON value
    case stringAddress string of
      Nothing -> fail $ "Could not decode Address: " <> string
      Just address -> return address
instance ToHttpApiData Address where
  toUrlPiece = Text.pack . addressString
instance FromHttpApiData Address where
  parseUrlPiece text = case stringAddress (Text.unpack text) of
    Nothing -> Left $ "Could not decode Address: " <> text
    Just address -> Right address
instance ToForm Address where
  toForm address = [("address", toQueryParam address)]
instance FromForm Address where fromForm = parseUnique "address"
instance Arbitrary Address where
  arbitrary = Address . fromInteger <$> arbitrary

newtype Keccak256 = Keccak256 Word256 deriving (Eq,Show,Generic)
keccak256String :: Keccak256 -> String
keccak256String (Keccak256 hash) = padZeros 32 (showHex hash "")
stringKeccak256 :: String -> Maybe Keccak256
stringKeccak256 string = Keccak256 . fromInteger <$> readMaybe ("0x" ++ string)
instance ToJSON Keccak256 where toJSON = toJSON . keccak256String
instance FromJSON Keccak256 where
  parseJSON value = do
    string <- parseJSON value
    case stringKeccak256 string of
      Nothing -> fail $ "Could not decode Keccak256: " <> string
      Just hash -> return hash
instance ToHttpApiData Keccak256 where
  toUrlPiece = Text.pack . keccak256String
instance FromHttpApiData Keccak256 where
  parseUrlPiece text = case stringKeccak256 (Text.unpack text) of
    Nothing -> Left $ "Could not decode Keccak256: " <> text
    Just hash -> Right hash
instance ToForm Keccak256 where
  toForm hash = [("hash", toQueryParam hash)]
instance FromForm Keccak256 where fromForm = parseUnique "hash"
instance Arbitrary Keccak256 where
  arbitrary = Keccak256 . fromInteger <$> arbitrary

newtype Nonce = Nonce Word256 deriving (Eq,Show,Generic)
newtype Wei = Wei Word256 deriving (Eq,Show,Generic)
instance Monoid Wei where
  mempty = Wei 0
  mappend (Wei x) (Wei y) = Wei (x+y)

data AccountState = AccountState
  { accountStateNonce :: Nonce
  , accountStateBalance :: Wei
  , accountStateStorageRoot :: Keccak256
  , accountStateCodeHash :: Keccak256
  } deriving (Eq,Show,Generic)

newtype Gas = Gas Word256 deriving (Eq,Show,Generic)

data Transaction = Transaction
  { transactionNonce :: Nonce
  , transactionGasPrice :: Wei
  , transactionGasLimit :: Gas
  , transactionTo :: Maybe Address
  , transactionValue :: Wei
  , transactionSignature :: CompactRecSig
  } deriving (Eq,Show,Generic)

-- helpers
padZeros :: Int -> String -> String
padZeros n string = replicate (n - length string) '0' ++ string
