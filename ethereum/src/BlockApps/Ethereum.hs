{-# LANGUAGE DataKinds             #-}
{-# LANGUAGE DeriveGeneric         #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedLists       #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE RecordWildCards       #-}
{-# LANGUAGE TypeApplications      #-}

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
  , keccak256ByteString
  , byteStringKeccak256
  , keccak256String
  , stringKeccak256
  , keccak256Address
    -- * Account States
  , AccountState (..)
    -- * Transactions
  , Transaction (..)
  , UnsignedTransaction (..)
  , rlpMsg
  , signTransaction
  , verifyTransaction
  , recoverTransaction
  , transactionFrom
  , newAccountAddress
    -- * Blocks
  , BlockHeader (..)
    -- * Ethereum Types
  , Nonce (..)
  , incrNonce
  , Wei (..)
  , eth
  , Gas (..)
  , BloomFilter (..)
  ) where

import           Control.Lens                 (mapped, (&), (.~), (?~))
import           Crypto.Hash
import           Crypto.Random.Entropy
import           Crypto.Secp256k1
import           Data.Aeson                   hiding (Array, String)
import qualified Data.Aeson                   as Aeson
import qualified Data.Aeson.Encoding          as AesonEnc
import qualified Data.Binary                  as Binary
import qualified Data.ByteArray               as ByteArray
import           Data.ByteString              (ByteString)
import qualified Data.ByteString              as ByteString
import qualified Data.ByteString.Base16       as Base16
import qualified Data.ByteString.Char8        as Char8
import qualified Data.ByteString.Lazy         as Lazy
import           Data.LargeWord
import           Data.Maybe
import           Data.Monoid
import           Data.Proxy
import           Data.RLP
import           Data.Swagger
import           Data.Swagger.Internal.Schema (named, plain)
import qualified Data.Text                    as Text
import           Data.Time
import           Data.Word
import           GHC.Generics
import           Numeric
import           Numeric.Natural
import           Servant.API
import           Servant.Docs
import           Test.QuickCheck
import           Text.Read                    hiding (String)
import           Web.FormUrlEncoded           hiding (fieldLabelModifier)

newtype Address = Address { unAddress :: Word160 }
  deriving (Eq, Ord, Show, Generic, Bounded)


instance ToJSONKey Address where
  toJSONKey = ToJSONKeyText f g
    where f x = Text.pack $ addressString x
          g x = AesonEnc.text . Text.pack $ addressString x


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
      Nothing      -> fail $ "Could not decode Address: " <> string
      Just address -> return address

instance ToHttpApiData Address where
  toUrlPiece = Text.pack . addressString

instance FromHttpApiData Address where
  parseUrlPiece text = case stringAddress (Text.unpack text) of
    Nothing      -> Left $ "Could not decode Address: " <> text
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

instance RLPEncodable (Maybe Address) where
  rlpEncode = maybe rlp0 rlpEncode
  rlpDecode x = if x == rlp0 then return Nothing else Just <$> rlpDecode x

instance ToCapture (Capture "userAddress" Address) where
  toCapture _ = DocCapture "userAddress" "an Ethereum address"

instance ToParamSchema Address where
  toParamSchema _ = mempty
    & type_ .~ SwaggerString
    & minimum_ ?~ fromInteger (toInteger . unAddress $ (minBound :: Address))
    & maximum_ ?~ fromInteger (toInteger . unAddress $ (maxBound :: Address))
    & format ?~ "hex string"

instance ToSchema Address where
  declareNamedSchema proxy = (plain . paramSchemaToSchema $ proxy)
    & mapped.name ?~ "Address"
    & mapped.schema.example ?~ toJSON (Address 0xdeadbeef)

deriveAddress :: PubKey -> Address
deriveAddress = keccak256Address . ByteString.drop 1 . exportPubKey False

--------------------------------------------------------------------------------

newSecKey :: IO SecKey
newSecKey = fromMaybe err . secKey <$> getEntropy 32
  where
    err = error "could not generate secret key"
--------------------------------------------------------------------------------

newtype Keccak256 = Keccak256 { digestKeccak256 :: Digest Keccak_256 }
  deriving (Eq,Ord,Show,Generic)
keccak256ByteString :: Keccak256 -> ByteString
keccak256ByteString = ByteArray.convert . digestKeccak256

byteStringKeccak256 :: ByteString -> Maybe Keccak256
byteStringKeccak256 = fmap Keccak256 . digestFromByteString

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
      Nothing      -> fail $ "Could not decode Keccak256: " <> string
      Just hash256 -> return hash256
instance ToJSONKey Keccak256 where
    toJSONKey = ToJSONKeyText f f'
        where f k = let (Aeson.String s) = toJSON k in s
              f'  = AesonEnc.text . f
instance FromJSONKey Keccak256 where
    fromJSONKey = FromJSONKeyTextParser (parseJSON . Aeson.String)

instance ToHttpApiData Keccak256 where
  toUrlPiece = Text.pack . keccak256String

instance FromHttpApiData Keccak256 where
  parseUrlPiece text = case stringKeccak256 (Text.unpack text) of
    Nothing      -> Left $ "Could not decode Keccak256: " <> text
    Just hash256 -> Right hash256

instance ToForm Keccak256 where
  toForm hash256 = [("hash", toQueryParam hash256)]

instance FromForm Keccak256 where fromForm = parseUnique "hash"
instance MimeUnrender PlainText Keccak256 where
  mimeUnrender _ = maybe (Left "Couldn't read Keccak") Right . stringKeccak256 . Char8.unpack . Lazy.toStrict
instance MimeRender PlainText Keccak256 where
  mimeRender _ = Lazy.fromStrict . Char8.pack . keccak256String

instance Arbitrary Keccak256 where
  arbitrary = keccak256lazy . Binary.encode @ Integer <$> arbitrary

keccak256 :: ByteString -> Keccak256
keccak256 = Keccak256 . hash

keccak256lazy :: Lazy.ByteString -> Keccak256
keccak256lazy = Keccak256 . hashlazy

instance ToSample Keccak256 where
  toSamples _ =
    samples [keccak256lazy (Binary.encode @ Integer n) | n <- [1..10]]

instance ToSchema Keccak256 where
  declareNamedSchema = const . pure $ named "Keccak256" byteSchema

keccak256Address :: ByteString -> Address
keccak256Address
  = Address
  . Binary.decode
  . Lazy.fromStrict
  . ByteString.drop 12
  . ByteArray.convert
  . digestKeccak256
  . keccak256

data AccountState = AccountState
  { accountStateNonce       :: Nonce
  , accountStateBalance     :: Wei
  , accountStateStorageRoot :: Keccak256
  , accountStateCodeHash    :: Keccak256
  } deriving (Eq,Show,Generic)

data Transaction = Transaction
  { transactionNonce      :: Nonce
  , transactionGasPrice   :: Wei
  , transactionGasLimit   :: Gas
  , transactionTo         :: Maybe Address
  , transactionValue      :: Wei
  , transactionInitOrData :: ByteString
  , transactionV          :: Word8
  , transactionR          :: Word256
  , transactionS          :: Word256
  } deriving (Eq,Show,Generic)

instance RLPEncodable Transaction where
  rlpEncode Transaction{..} = rlpEncode
    ( transactionNonce
    , transactionGasPrice
    , transactionGasLimit
    , transactionTo
    , transactionValue
    , transactionInitOrData
    , transactionV
    , transactionR
    , transactionS
    )
  rlpDecode x = do
    (nonce, gasPrice, gasLimit, toAddr, value, initOrData, v, r, s)
      <- rlpDecode x
    return Transaction
      { transactionNonce = nonce
      , transactionGasPrice = gasPrice
      , transactionGasLimit = gasLimit
      , transactionTo = toAddr
      , transactionValue = value
      , transactionInitOrData = initOrData
      , transactionV = v
      , transactionR = r
      , transactionS = s
      }

data UnsignedTransaction = UnsignedTransaction
  { unsignedTransactionNonce      :: Nonce
  , unsignedTransactionGasPrice   :: Wei
  , unsignedTransactionGasLimit   :: Gas
  , unsignedTransactionTo         :: Maybe Address
  , unsignedTransactionValue      :: Wei
  , unsignedTransactionInitOrData :: ByteString
  } deriving (Eq,Show,Generic)

instance RLPEncodable UnsignedTransaction where
  rlpEncode UnsignedTransaction{..} = rlpEncode Transaction
    { transactionNonce = unsignedTransactionNonce
    , transactionGasPrice = unsignedTransactionGasPrice
    , transactionGasLimit = unsignedTransactionGasLimit
    , transactionTo = unsignedTransactionTo
    , transactionValue = unsignedTransactionValue
    , transactionInitOrData = unsignedTransactionInitOrData
    , transactionV = 0
    , transactionR = 0
    , transactionS = 0
    }
  rlpDecode x = do
    Transaction{..} <- rlpDecode x
    if (transactionV,transactionR,transactionS) /= (0,0,0)
      then Left "rlpDecode UnsignedTransaction: expected v,r,s = 0"
      else return UnsignedTransaction
        { unsignedTransactionNonce = transactionNonce
        , unsignedTransactionGasPrice = transactionGasPrice
        , unsignedTransactionGasLimit = transactionGasLimit
        , unsignedTransactionTo = transactionTo
        , unsignedTransactionValue = transactionValue
        , unsignedTransactionInitOrData = transactionInitOrData
        }

rlpMsg :: RLPEncodable x => x -> Msg
rlpMsg
  = fromMaybe (error "rlpMsg failure")
  . msg
  . ByteArray.convert
  . digestKeccak256
  . keccak256
  . packRLP
  . rlpEncode

signTransaction :: SecKey -> UnsignedTransaction -> Transaction
signTransaction sk UnsignedTransaction{..} = Transaction
  { transactionNonce = unsignedTransactionNonce
  , transactionGasPrice = unsignedTransactionGasPrice
  , transactionGasLimit = unsignedTransactionGasLimit
  , transactionTo = unsignedTransactionTo
  , transactionValue = unsignedTransactionValue
  , transactionV = testV + 27
  , transactionR = r
  , transactionS = s
  , transactionInitOrData = unsignedTransactionInitOrData
  }
  where
    CompactRecSig r s testV =
      exportCompactRecSig . signRecMsg sk $ rlpMsg
        ( unsignedTransactionNonce
        , unsignedTransactionGasPrice
        , unsignedTransactionGasLimit
        , unsignedTransactionTo
        , unsignedTransactionValue
        , unsignedTransactionInitOrData
        )

verifyTransaction :: PubKey -> Transaction -> Bool
verifyTransaction pk Transaction{..} =
  let
    message = rlpMsg
      ( transactionNonce
      , transactionGasPrice
      , transactionGasLimit
      , transactionTo
      , transactionValue
      , transactionInitOrData
      )
  in
    case importCompactSig (CompactSig transactionR transactionS) of
      Nothing  -> False
      Just sig -> verifySig pk sig message

recoverTransaction :: Transaction -> Maybe PubKey
recoverTransaction Transaction{..} = do
  let
    message = rlpMsg
      ( transactionNonce
      , transactionGasPrice
      , transactionGasLimit
      , transactionTo
      , transactionValue
      , transactionInitOrData
      )
    testV = transactionV - 27
    compactRecSig = CompactRecSig transactionR transactionS testV
  recSig <- importCompactRecSig compactRecSig
  recover recSig message

transactionFrom :: Transaction -> Maybe Address
transactionFrom = fmap deriveAddress . recoverTransaction

-- | Yellow Paper (82)
newAccountAddress :: Transaction -> Address
newAccountAddress Transaction{..}
  = keccak256Address $ rlpSerialize (transactionTo, transactionNonce)

data BlockHeader = BlockHeader
  { blockHeaderParentHash       :: Keccak256
  , blockHeaderOmmersHash       :: Keccak256
  , blockHeaderBeneficiary      :: Address
  , blockHeaderStateRoot        :: Keccak256
  , blockHeaderTransactionsRoot :: Keccak256
  , blockHeaderReceiptsRoot     :: Keccak256
  , blockHeaderLogsBloom        :: BloomFilter
  , blockHeaderDifficulty       :: Natural
  , blockHeaderNumber           :: Natural
  , blockHeaderGasLimit         :: Gas
  , blockHeaderGasUsed          :: Gas
  , blockHeaderTimeStamp        :: UTCTime
  , blockHeaderExtraData        :: Word256
  , blockHeaderMixHash          :: Keccak256
  , blockHeaderNonce            :: Nonce
  } deriving (Eq,Show,Generic)

newtype Nonce = Nonce Word256 deriving (Eq,Show,Generic)

instance ToJSON Nonce where
  toJSON (Nonce n) = toJSON $ toInteger n

instance FromJSON Nonce where
  parseJSON = fmap (Nonce . fromInteger) . parseJSON

instance ToParamSchema Nonce where
  toParamSchema _ = toParamSchemaBoundedIntegral $ Proxy @ Word256

instance ToSchema Nonce where
  declareNamedSchema = pure . named "Nonce" . paramSchemaToSchema

instance Arbitrary Nonce where arbitrary = Nonce . fromInteger <$> arbitrary

instance RLPEncodable Nonce where
  rlpEncode (Nonce n) = rlpEncode $ toInteger n
  rlpDecode obj = Nonce . fromInteger <$> rlpDecode obj

incrNonce :: Nonce -> Nonce
incrNonce (Nonce n) = Nonce (n+1)

newtype Wei = Wei Word256 deriving (Eq,Show,Generic)

--TODO- this might be unsafe, since it could lead to an overflow.  A Word256 * 10^18 certainly can be much higer than a Word256
eth::Word256->Wei
eth x = Wei $ 10^(18::Integer) * x

instance Arbitrary Wei where arbitrary = Wei . fromInteger <$> arbitrary

instance ToParamSchema Wei where
  toParamSchema _ = toParamSchemaBoundedIntegral $ Proxy @ Word256

instance ToSchema Wei where
  declareNamedSchema = pure . named "Wei" . paramSchemaToSchema

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

instance ToParamSchema Gas where
  toParamSchema _ = toParamSchemaBoundedIntegral $ Proxy @ Word256

instance ToSchema Gas where
  declareNamedSchema = pure . named "Gas" . paramSchemaToSchema

instance RLPEncodable Gas where
  rlpEncode (Gas n) = rlpEncode $ toInteger n
  rlpDecode obj = Gas . fromInteger <$> rlpDecode obj

newtype BloomFilter = BloomFilter
  ( LargeKey
    (LargeKey (LargeKey Word256 Word256) (LargeKey Word256 Word256))
    (LargeKey (LargeKey Word256 Word256) (LargeKey Word256 Word256))
  ) deriving (Eq,Show,Generic)
