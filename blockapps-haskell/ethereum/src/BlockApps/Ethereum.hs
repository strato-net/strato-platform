{-# OPTIONS_GHC -fno-warn-orphans  #-}
{-# LANGUAGE DataKinds             #-}
{-# LANGUAGE DeriveGeneric         #-}
{-# LANGUAGE FlexibleContexts      #-}
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
  -- , eth
  , Gas (..)
  , BloomFilter (..)
  ) where

import           Control.Lens.Operators
import           Control.Monad (liftM2)
import           Control.DeepSeq (NFData, rnf)
import           Crypto.Hash
import           Crypto.Random.Entropy
import           Crypto.Secp256k1
import           Data.Aeson             hiding (Array, String)
import qualified Data.Aeson             as Aeson
import qualified Data.Aeson.Encoding    as AesonEnc
import qualified Data.Binary            as Binary
import qualified Data.ByteArray         as ByteArray
import           Data.ByteString        (ByteString)
import qualified Data.ByteString        as ByteString
import qualified Data.ByteString.Base16 as Base16
import qualified Data.ByteString.Char8  as Char8
import qualified Data.ByteString.Lazy   as Lazy
import           Data.LargeWord
import           Data.Maybe
import           Data.Monoid
import           Data.Proxy
import           Data.RLP
import           Data.Swagger
import qualified Data.Text              as Text
import           Data.Time
import           Data.Word
import           GHC.Generics
import           Numeric
import           Numeric.Natural
import           Servant.API
import           Servant.Docs
import           Test.QuickCheck
import           Text.Read              hiding (String)
import           Web.FormUrlEncoded     hiding (fieldLabelModifier)

instance (Arbitrary a, Arbitrary b) => Arbitrary (LargeKey a b) where
  arbitrary = (liftM2 LargeKey) arbitrary arbitrary

instance (NFData a, NFData b) => NFData (LargeKey a b) where
  rnf (LargeKey a b) = rnf a `seq` rnf b `seq` ()

newtype Address = Address { unAddress :: Word160 }
  deriving (Eq, Ord, Generic, Bounded)

instance NFData Address

instance Show Address where show = addressString

instance ToJSONKey Address where
  toJSONKey = ToJSONKeyText f g
    where f x = Text.pack $ addressString x
          g x = AesonEnc.text . Text.pack $ addressString x

padZeros :: Int -> String -> String
padZeros n string = replicate (n - length string) '0' ++ string

show160 :: Word160 -> String
show160 (LargeKey w32 w128) = (show128 w128) ++ (padZeros 8 (showHex w32 ""))

show128 :: Word128 -> String
show128 (LargeKey w1 w2) = (padZeros 16 (showHex w2 "")) ++ (padZeros 16 (showHex w1 ""))

addressString :: Address -> String
addressString (Address address) = show160 address

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
  rlpEncode addr = rlpEncode . fst . Base16.decode . Char8.pack $ addressString addr
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
  declareNamedSchema _ = return $
    NamedSchema (Just "Address")
      ( mempty
        & type_ .~ SwaggerString
        & example ?~ "address=deadbeef" --toJSON (Address 0xdeadbeef) -- FIXME if causing troubles outside /faucet
        & description ?~ "Ethereum Address, 20 byte hex encoded string" )

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

instance MimeRender PlainText [Keccak256] where
  mimeRender _ = encode

instance MimeUnrender PlainText [Keccak256] where
  mimeUnrender _ = maybe (Left "Couldn't decode [Keccak256]") Right . decode

instance Arbitrary Keccak256 where
  arbitrary = keccak256lazy . Binary.encode @ Integer <$> arbitrary

instance ToCapture (Capture "hash" Keccak256) where
  toCapture _ = DocCapture "hash" "a transaction hash"

keccak256 :: ByteString -> Keccak256
keccak256 = Keccak256 . hash

keccak256lazy :: Lazy.ByteString -> Keccak256
keccak256lazy = Keccak256 . hashlazy

instance ToSample Keccak256 where
  toSamples _ =
    samples [keccak256lazy (Binary.encode @ Integer n) | n <- [1..10]]

instance ToSchema Keccak256 where
  declareNamedSchema _ = return $
    NamedSchema (Just "Keccak256 hash, 32 byte hex encoded string")
      ( mempty
        & type_ .~ SwaggerString
        & example ?~ toJSON (keccak256lazy (Binary.encode @ Integer 1))
        & description ?~ "Keccak256 hash, 32 byte hex encoded string" )

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
  , accountStateChainId     :: Maybe Word256
  } deriving (Eq,Show,Generic)

data Transaction = Transaction
  { transactionNonce      :: Nonce
  , transactionGasPrice   :: Wei
  , transactionGasLimit   :: Gas
  , transactionTo         :: Maybe Address
  , transactionValue      :: Wei
  , transactionInitOrData :: ByteString
  , transactionChainId    :: Maybe Word256
  , transactionV          :: Word8
  , transactionR          :: Word256
  , transactionS          :: Word256
  } deriving (Eq,Show,Generic)

instance NFData Transaction

instance RLPEncodable Transaction where
  rlpEncode Transaction{..} = Array $
    [ rlpEncode transactionNonce
    , rlpEncode transactionGasPrice
    , rlpEncode transactionGasLimit
    , rlpEncode transactionTo
    , rlpEncode transactionValue
    , rlpEncode transactionInitOrData
    , rlpEncode transactionV
    , rlpEncode transactionR
    , rlpEncode transactionS
    ] ++ (maybeToList $ fmap rlpEncode transactionChainId)
  rlpDecode (Array [n, gp, gl, to', va, iod, v', r', s', cid]) =
    Transaction
      <$> rlpDecode n
      <*> rlpDecode gp
      <*> rlpDecode gl
      <*> rlpDecode to'
      <*> rlpDecode va
      <*> rlpDecode iod
      <*> (Just <$> rlpDecode cid)
      <*> rlpDecode v'
      <*> rlpDecode r'
      <*> rlpDecode s'
  rlpDecode (Array [n, gp, gl, to', va, iod, v', r', s']) =
    Transaction
      <$> rlpDecode n
      <*> rlpDecode gp
      <*> rlpDecode gl
      <*> rlpDecode to'
      <*> rlpDecode va
      <*> rlpDecode iod
      <*> pure Nothing
      <*> rlpDecode v'
      <*> rlpDecode r'
      <*> rlpDecode s'
  rlpDecode x = Left $ "rlpDecode Transaction: Got " ++ show x

data UnsignedTransaction = UnsignedTransaction
  { unsignedTransactionNonce      :: Nonce
  , unsignedTransactionGasPrice   :: Wei
  , unsignedTransactionGasLimit   :: Gas
  , unsignedTransactionTo         :: Maybe Address
  , unsignedTransactionValue      :: Wei
  , unsignedTransactionInitOrData :: ByteString
  , unsignedTransactionChainId    :: Maybe Word256
  } deriving (Eq,Show,Generic)

instance RLPEncodable UnsignedTransaction where
  rlpEncode UnsignedTransaction{..} = rlpEncode Transaction
    { transactionNonce = unsignedTransactionNonce
    , transactionGasPrice = unsignedTransactionGasPrice
    , transactionGasLimit = unsignedTransactionGasLimit
    , transactionTo = unsignedTransactionTo
    , transactionValue = unsignedTransactionValue
    , transactionInitOrData = unsignedTransactionInitOrData
    , transactionChainId = unsignedTransactionChainId
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
        , unsignedTransactionChainId = transactionChainId
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
  , transactionChainId = unsignedTransactionChainId
  }
  where
    CompactRecSig r s testV =
      exportCompactRecSig
      . signRecMsg sk
      . rlpMsg
      . Array
      $ [ rlpEncode unsignedTransactionNonce
        , rlpEncode unsignedTransactionGasPrice
        , rlpEncode unsignedTransactionGasLimit
        , rlpEncode unsignedTransactionTo
        , rlpEncode unsignedTransactionValue
        , rlpEncode unsignedTransactionInitOrData
        ] ++ (maybeToList $ fmap rlpEncode unsignedTransactionChainId)

verifyTransaction :: PubKey -> Transaction -> Bool
verifyTransaction pk Transaction{..} =
  let
    message = rlpMsg . Array $
      [ rlpEncode transactionNonce
      , rlpEncode transactionGasPrice
      , rlpEncode transactionGasLimit
      , rlpEncode transactionTo
      , rlpEncode transactionValue
      , rlpEncode transactionInitOrData
      ] ++ (maybeToList $ fmap rlpEncode transactionChainId)
  in
    case importCompactSig (CompactSig transactionR transactionS) of
      Nothing  -> False
      Just sig -> verifySig pk sig message

recoverTransaction :: Transaction -> Maybe PubKey
recoverTransaction Transaction{..} = do
  let
    message = rlpMsg . Array $
      [ rlpEncode transactionNonce
      , rlpEncode transactionGasPrice
      , rlpEncode transactionGasLimit
      , rlpEncode transactionTo
      , rlpEncode transactionValue
      , rlpEncode transactionInitOrData
      ] ++ (maybeToList $ fmap rlpEncode transactionChainId)
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
  , blockHeaderChainId          :: Maybe Word256
  } deriving (Eq,Show,Generic)

newtype Nonce = Nonce Word256 deriving (Eq,Show,Generic)
instance NFData Nonce

instance ToJSON Nonce where
  toJSON (Nonce n) = toJSON $ toInteger n

instance FromJSON Nonce where
  parseJSON = fmap (Nonce . fromInteger) . parseJSON

instance ToParamSchema Nonce where
  toParamSchema _ = toParamSchemaBoundedIntegral $ Proxy @ Word256

instance ToSchema Nonce where
  declareNamedSchema _ = return $
    NamedSchema (Just "Nonce")
      ( mempty
        & type_ .~ SwaggerInteger
        & example ?~ toJSON (Nonce 1)
        & description ?~ "Numeric Nonce" )

instance Arbitrary Nonce where arbitrary = Nonce . fromInteger <$> arbitrary

instance RLPEncodable Nonce where
  rlpEncode (Nonce n) = rlpEncode $ toInteger n
  rlpDecode obj = Nonce . fromInteger <$> rlpDecode obj

incrNonce :: Nonce -> Nonce
incrNonce (Nonce n) = Nonce (n+1)

newtype Wei = Wei Word256 deriving (Eq,Show,Generic)
instance NFData Wei

-- --TODO- this might be unsafe, since it could lead to an overflow.  A Word256 * 10^18 certainly can be much higer than a Word256
-- eth::Word256->Wei
-- eth = Wei

instance Arbitrary Wei where arbitrary = Wei . fromInteger <$> arbitrary

instance ToParamSchema Wei where
  toParamSchema _ = toParamSchemaBoundedIntegral $ Proxy @ Word256

instance ToSchema Wei where
  declareNamedSchema _ = return $
    NamedSchema (Just "Wei")
      ( mempty
        & type_ .~ SwaggerInteger
        & example ?~ toJSON (Wei 1000000)
        & description ?~ "Number of Wei currency units" )

instance ToJSON Wei where
  toJSON (Wei g) = toJSON $ toInteger g

instance FromJSON Wei where
  parseJSON = fmap (Wei . fromInteger) . parseJSON

instance RLPEncodable Wei where
  rlpEncode (Wei n) = rlpEncode $ toInteger n
  rlpDecode obj = Wei . fromInteger <$> rlpDecode obj

newtype Gas = Gas Word256 deriving (Eq,Show,Generic)

instance NFData Gas

instance Arbitrary Gas where arbitrary = Gas . fromInteger <$> arbitrary

instance ToJSON Gas where
  toJSON (Gas g) = toJSON $ toInteger g

instance FromJSON Gas where
  parseJSON = fmap (Gas . fromInteger) . parseJSON

instance ToParamSchema Gas where
  toParamSchema _ = toParamSchemaBoundedIntegral $ Proxy @ Word256

instance ToSchema Gas where
  declareNamedSchema _ = return $
    NamedSchema (Just "Gas")
      ( mempty
        & type_ .~ SwaggerInteger
        & example ?~ toJSON (Gas 1000)
        & description ?~ "Number of Gas units" )

instance RLPEncodable Gas where
  rlpEncode (Gas n) = rlpEncode $ toInteger n
  rlpDecode obj = Gas . fromInteger <$> rlpDecode obj

newtype BloomFilter = BloomFilter
  ( LargeKey
    (LargeKey (LargeKey Word256 Word256) (LargeKey Word256 Word256))
    (LargeKey (LargeKey Word256 Word256) (LargeKey Word256 Word256))
  ) deriving (Eq,Show,Generic)
