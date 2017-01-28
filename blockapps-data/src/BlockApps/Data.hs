{-# LANGUAGE
    DataKinds
  , DeriveGeneric
  , FlexibleInstances
  , OverloadedLists
  , OverloadedStrings
  , TypeApplications
#-}

module BlockApps.Data
  ( -- * Addresses
    Address (..)
  , deriveAddress
  , addressString
  , stringAddress
  , newSecKey
    -- * Keccak 256 Hashes
  , Keccak256 (..)
  , keccak256
  , keccak256lazy
  , keccak256String
  , stringKeccak256
    -- * Account States
  , AccountState (..)
    -- * Transactions
  , Transaction (..)
  , UnsignedTransaction (..)
    -- * Blocks
  , BlockHeader (..)
    -- * Ethereum Types
  , Nonce (..)
  , Wei (..)
  , Gas (..)
  , BloomFilter (..)
  ) where

import Crypto.Hash
import Crypto.Random
import Crypto.Secp256k1
import Data.Aeson
import qualified Data.Binary as Binary
import Data.ByteString (ByteString)
import qualified Data.ByteString as ByteString
import qualified Data.ByteString.Char8 as Char8
import qualified Data.ByteString.Base16 as Base16
import qualified Data.ByteString.Lazy as Lazy (ByteString)
import Data.LargeWord
import Data.Maybe
import Data.Monoid
import qualified Data.Text as Text
import Data.Time
import GHC.Generics
import Numeric
import Numeric.Natural
import Servant.API
import Servant.Docs
import Test.QuickCheck
import Text.Read
import Web.FormUrlEncoded

newtype Address = Address Word160 deriving (Eq, Ord, Show, Generic)
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
instance ToSample Address where
  toSamples _ = samples [Address 0xdeadbeef, Address 0x12345678]
instance ToCapture (Capture "address" Address) where
  toCapture _ = DocCapture "address" "an Ethereum address"
instance ToCapture (Capture "contractAddress" Address) where
  toCapture _ = DocCapture "contractAddress" "an Ethereum address"
instance ToCapture (Capture "userAddress" Address) where
  toCapture _ = DocCapture "userAddress" "an Ethereum address"

deriveAddress :: PubKey -> Address
deriveAddress
  = fromMaybe (error "Could not derive Address")
  . stringAddress
  . drop 24
  . keccak256String
  . keccak256
  . ByteString.drop 1
  . exportPubKey False

newSecKey :: IO (Maybe SecKey)
newSecKey = secKey <$> getRandomBytes 32

newtype Keccak256 = Keccak256 (Digest Keccak_256) deriving (Eq,Show,Generic)
keccak256String :: Keccak256 -> String
keccak256String (Keccak256 digest) = show digest
stringKeccak256 :: String -> Maybe Keccak256
stringKeccak256 string =
  if ByteString.null r then Keccak256 <$> digestFromByteString bs else Nothing
  where
    (bs, r) = Base16.decode $ Char8.pack string
instance ToJSON Keccak256 where toJSON = toJSON . keccak256String
instance FromJSON Keccak256 where
  parseJSON value = do
    string <- parseJSON value
    case stringKeccak256 string of
      Nothing -> fail $ "Could not decode Keccak256: " <> string
      Just hash256 -> return hash256
instance ToHttpApiData Keccak256 where
  toUrlPiece = Text.pack . keccak256String
instance FromHttpApiData Keccak256 where
  parseUrlPiece text = case stringKeccak256 (Text.unpack text) of
    Nothing -> Left $ "Could not decode Keccak256: " <> text
    Just hash256 -> Right hash256
instance ToForm Keccak256 where
  toForm hash256 = [("hash", toQueryParam hash256)]
instance FromForm Keccak256 where fromForm = parseUnique "hash"
instance Arbitrary Keccak256 where
  arbitrary = keccak256lazy . Binary.encode @ Integer <$> arbitrary
keccak256 :: ByteString -> Keccak256
keccak256 = Keccak256 . hash
keccak256lazy :: Lazy.ByteString -> Keccak256
keccak256lazy = Keccak256 . hashlazy
instance ToSample Keccak256 where
  toSamples _ =
    samples [keccak256lazy (Binary.encode @ Integer n) | n <- [1..10]]

data AccountState = AccountState
  { accountStateNonce :: Nonce
  , accountStateBalance :: Wei
  , accountStateStorageRoot :: Keccak256
  , accountStateCodeHash :: Keccak256
  } deriving (Eq,Show,Generic)

data Transaction = Transaction
  { transactionNonce :: Nonce
  , transactionGasPrice :: Wei
  , transactionGasLimit :: Gas
  , transactionTo :: Maybe Address
  , transactionValue :: Wei
  , transactionSignature :: CompactRecSig
  , transactionInitOrData :: ByteString
  } deriving (Eq,Show,Generic)

data UnsignedTransaction = UnsignedTransaction
  { unsignedTransactionNonce :: Nonce
  , unsignedTransactionGasPrice :: Wei
  , unsignedTransactionGasLimit :: Gas
  , unsignedTransactionTo :: Maybe Address
  , unsignedTransactionValue :: Wei
  , unsignedTransactionInitOrData :: ByteString
  } deriving (Eq,Show,Generic)

data BlockHeader = BlockHeader
  { blockHeaderParentHash :: Keccak256
  , blockHeaderOmmersHash :: Keccak256
  , blockHeaderBeneficiary :: Address
  , blockHeaderStateRoot :: Keccak256
  , blockHeaderTransactionsRoot :: Keccak256
  , blockHeaderReceiptsRoot :: Keccak256
  , blockHeaderLogsBloom :: BloomFilter
  , blockHeaderDifficulty :: Natural
  , blockHeaderNumber :: Natural
  , blockHeaderGasLimit :: Gas
  , blockHeaderGasUsed :: Gas
  , blockHeaderTimeStamp :: UTCTime
  , blockHeaderExtraData :: Word256
  , blockHeaderMixHash :: Keccak256
  , blockHeaderNonce :: Nonce
  } deriving (Eq,Show,Generic)

newtype Nonce = Nonce Word256 deriving (Eq,Show,Generic)

newtype Wei = Wei Word256 deriving (Eq,Show,Generic)

newtype Gas = Gas Word256 deriving (Eq,Show,Generic)

newtype BloomFilter = BloomFilter
  ( LargeKey
    (LargeKey (LargeKey Word256 Word256) (LargeKey Word256 Word256))
    (LargeKey (LargeKey Word256 Word256) (LargeKey Word256 Word256))
  ) deriving (Eq,Show,Generic)

-- helpers
padZeros :: Int -> String -> String
padZeros n string = replicate (n - length string) '0' ++ string
