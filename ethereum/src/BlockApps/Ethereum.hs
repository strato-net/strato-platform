{-# LANGUAGE
    DataKinds
  , DeriveGeneric
  , FlexibleInstances
  , LambdaCase
  , OverloadedLists
  , OverloadedStrings
  , RecordWildCards
  , TypeApplications
#-}

module BlockApps.Ethereum
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
  , signRLP
  , signTransaction
    -- * Blocks
  , BlockHeader (..)
    -- * Ethereum Types
  , Nonce (..)
  , incrNonce
  , Wei (..)
  , Gas (..)
  , BloomFilter (..)
  ) where

import Control.Applicative
import Crypto.Hash
import Crypto.Random.Entropy
import Crypto.Secp256k1
import Data.Aeson hiding (Array,String)
import qualified Data.Binary as Binary
import Data.ByteArray (convert)
import Data.ByteString (ByteString)
import qualified Data.ByteString as ByteString
import qualified Data.ByteString.Char8 as Char8
import qualified Data.ByteString.Base16 as Base16
import qualified Data.ByteString.Lazy as Lazy (ByteString)
import Data.LargeWord
import Data.Maybe
import Data.Monoid
import Data.RLP
import qualified Data.Text as Text
import Data.Time
import GHC.Generics
import Numeric
import Numeric.Natural
import Servant.API
import Servant.Docs
import Test.QuickCheck
import Text.Read hiding (String)
import Web.FormUrlEncoded

newtype Address = Address Word160 deriving (Eq, Ord, Show, Generic)
addressString :: Address -> String
addressString (Address address) = padZeros 40 (showHex address "")
  where
    padZeros n string = replicate (n - length string) '0' ++ string
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
instance RLPEncodable Address where
  rlpEncode (Address addr) = rlpEncode $ toInteger addr
  rlpDecode obj = Address . fromInteger <$> rlpDecode obj

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

newSecKey :: IO SecKey
newSecKey = fromMaybe err . secKey <$> getEntropy 32
  where
    err = error "could not generate secret key"

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
instance RLPEncodable UnsignedTransaction where
  rlpEncode UnsignedTransaction{..} = Array
    [ rlpEncode unsignedTransactionNonce
    , rlpEncode unsignedTransactionGasPrice
    , rlpEncode unsignedTransactionGasLimit
    , maybe (String ByteString.empty) rlpEncode unsignedTransactionTo
    , rlpEncode unsignedTransactionValue
    , rlpEncode unsignedTransactionInitOrData
    ]
  rlpDecode = \case
    Array [ob1,ob2,ob3,ob4,ob5,ob6] -> UnsignedTransaction
      <$> rlpDecode ob1
      <*> rlpDecode ob2
      <*> rlpDecode ob3
      <*> ((Just <$> rlpDecode ob4) <|> (case ob4 of String "" -> Right Nothing; _ -> Left "aggg"))
      <*> rlpDecode ob5
      <*> rlpDecode ob6
    rlpObj -> Left $
      "rlpDecode UnsignedTransaction: Expected Array with 6 elements, Saw "
      ++ show rlpObj

signRLP :: RLPEncodable x => SecKey -> x -> CompactRecSig
signRLP sk x =
  let
    rlp = packRLP $ rlpEncode x
    Keccak256 hash = keccak256 rlp
    err = error "singRLP failure"
    message = fromMaybe err (msg (convert hash))
  in
    exportCompactRecSig $ signRecMsg sk message

signTransaction :: SecKey -> UnsignedTransaction -> Transaction
signTransaction sk utx@UnsignedTransaction{..} = Transaction
  { transactionNonce = unsignedTransactionNonce
  , transactionGasPrice = unsignedTransactionGasPrice
  , transactionGasLimit = unsignedTransactionGasLimit
  , transactionTo = unsignedTransactionTo
  , transactionValue = unsignedTransactionValue
  , transactionSignature = signRLP sk utx
  , transactionInitOrData = unsignedTransactionInitOrData
  }

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
instance ToJSON Nonce where
  toJSON (Nonce n) = toJSON $ toInteger n
instance FromJSON Nonce where
  parseJSON = fmap (Nonce . fromInteger) . parseJSON
instance Arbitrary Nonce where arbitrary = Nonce . fromInteger <$> arbitrary
instance RLPEncodable Nonce where
  rlpEncode (Nonce n) = rlpEncode $ toInteger n
  rlpDecode obj = Nonce . fromInteger <$> rlpDecode obj
incrNonce :: Nonce -> Nonce
incrNonce (Nonce n) = Nonce (n+1)

newtype Wei = Wei Word256 deriving (Eq,Show,Generic)
instance Arbitrary Wei where arbitrary = Wei . fromInteger <$> arbitrary
instance ToJSON Wei where
  toJSON (Wei g) = toJSON $ toInteger g
instance FromJSON Wei where
  parseJSON = fmap (Wei . fromInteger) . parseJSON
instance RLPEncodable Wei where
  rlpEncode (Wei n) = rlpEncode $ toInteger n
  rlpDecode obj = Wei . fromInteger <$> rlpDecode obj

newtype Gas = Gas Word256 deriving (Eq,Show,Generic)
instance Arbitrary Gas where arbitrary = Gas . fromInteger <$> arbitrary
instance ToJSON Gas where
  toJSON (Gas g) = toJSON $ toInteger g
instance FromJSON Gas where
  parseJSON = fmap (Gas . fromInteger) . parseJSON
instance RLPEncodable Gas where
  rlpEncode (Gas n) = rlpEncode $ toInteger n
  rlpDecode obj = Gas . fromInteger <$> rlpDecode obj

newtype BloomFilter = BloomFilter
  ( LargeKey
    (LargeKey (LargeKey Word256 Word256) (LargeKey Word256 Word256))
    (LargeKey (LargeKey Word256 Word256) (LargeKey Word256 Word256))
  ) deriving (Eq,Show,Generic)
