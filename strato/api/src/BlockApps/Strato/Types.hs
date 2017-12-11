{-# LANGUAGE DataKinds             #-}
{-# LANGUAGE DeriveAnyClass        #-}
{-# LANGUAGE DeriveGeneric         #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE RecordWildCards       #-}
{-# LANGUAGE ScopedTypeVariables   #-}
{-# LANGUAGE TypeApplications      #-}

{-# OPTIONS_GHC -fno-warn-orphans #-}

module BlockApps.Strato.Types
  ( Hex (..)
  , Strung (..)
  , Address (..)
  , addressString
  , stringAddress
  , Keccak256 (..)
  , WithNext (..)
  , FaucetResponse(..)
  , TransactionType (..)
  , Transaction (..)
  , TransactionResult (..)
  , BatchTransactionResult (..)
  , PostTransaction (..)
  , toPostTx
  , BlockData (..)
  , Block (..)
  , Account (..)
  , Difficulty (..)
  , TxCount (..)
  , Storage (..)
  , Src (..)
  , ExtabiResponse (..)
  , SolcResponse (..)
  , AbiBin (..)
  , exampleTxResult
  ) where

import           Control.Applicative
import           Control.Lens                 (mapped, (&), (.~), (?~))
import           Data.Aeson
import           Data.Aeson.Casing
import           Data.Aeson.Casing.Internal   (dropFPrefix)
import qualified Data.Binary                  as Binary
import qualified Data.ByteString.Lazy         as Lazy
import qualified Data.HashMap.Strict          as HashMap
import           Data.LargeWord
import           Data.List.NonEmpty           (NonEmpty)
import           Data.Map.Strict              (Map)
import           Data.Maybe
import           Data.Proxy
import           Data.Swagger
import           Data.Swagger.Internal.Schema (named, sketchSchema)
import           Data.Text                    (Text)
import qualified Data.Text                    as Text
import qualified Data.Text.Encoding           as Text
import           Data.Time
import           Data.Word
import           Generic.Random.Generic
import           GHC.Generics
import           Numeric
import           Numeric.Natural
import           Servant.API
import           Servant.Docs
import           Test.QuickCheck
import           Test.QuickCheck.Instances    ()
import           Text.Read
import           Text.Read.Lex
import           Web.FormUrlEncoded           hiding (fieldLabelModifier)

import           BlockApps.Ethereum           (Address (..), Keccak256 (..),
                                               Nonce (..), addressString,
                                               keccak256, keccak256lazy,
                                               stringAddress)

import           BlockApps.Solidity.Xabi

newtype FaucetResponse = FaucetResponse Text deriving (Eq, Generic, Show)

newtype Hex n = Hex { unHex :: n } deriving (Eq, Generic)

instance (Integral n, Show n) => Show (Hex n) where
  show (Hex n) = showHex n ""

instance (Eq n, Num n) => Read (Hex n) where
  readPrec = Hex <$> readP_to_Prec (const readHexP)
  --I'm not sure what `d` precision parameter is used for

instance Num n => FromJSON (Hex n) where
  parseJSON value = do
    string <- parseJSON value
    case fmap fromInteger (readMaybe ("0x" ++ string)) of
      Nothing -> fail $ "not hex encoded: " ++ string
      Just n  -> return $ Hex n

instance (Integral n, Show n) => ToJSON (Hex n) where
  toJSON = toJSON . show

instance (Integral n, Show n) => ToHttpApiData (Hex n) where
  toUrlPiece = Text.pack . show

instance Arbitrary x => Arbitrary (Hex x) where
  arbitrary = genericArbitrary uniform

instance (Arbitrary a, Arbitrary b) => Arbitrary (LargeKey a b) where
  arbitrary = do
    a <- arbitrary
    b <- arbitrary
    return $ LargeKey a b

instance ToSchema (Hex Word160) where
  declareNamedSchema = const . pure $ named "hex word160" binarySchema

instance ToSchema (Hex Word256) where
  declareNamedSchema = const . pure $ named "hex word256" binarySchema

instance ToSchema (Hex Word8) where
  declareNamedSchema = const . pure $ named "hex word8" binarySchema

instance ToSchema (Hex Natural) where
  declareNamedSchema = const . pure $ named "hex natural" $ sketchSchema (Hex (8 :: Natural))

-- hack to deal with weird `ToJSON`s
newtype Strung x = Strung { unStrung :: x } deriving (Eq, Show, Generic)

instance (FromJSON x, Read x) => FromJSON (Strung x) where
  parseJSON value = Strung <$> parseJSON value <|> do
    string <- parseJSON value
    case readMaybe string of
      Nothing -> fail $ "cannot decode Strung: " ++ string
      Just y  -> return $ Strung y

instance ToSchema x => ToSchema (WithNext x) where
  declareNamedSchema _ = declareNamedSchema (Proxy :: Proxy x)

instance ToSchema x => ToSchema (Strung x) where
  declareNamedSchema _ = declareNamedSchema (Proxy :: Proxy x)

instance ToSchema x => ToSchema (NonEmpty x) where
  declareNamedSchema _ = declareNamedSchema (Proxy :: Proxy x)

instance ToSchema FaucetResponse where
  declareNamedSchema proxy = genericDeclareNamedSchema stratoSchemaOptions proxy
    & mapped.schema.description ?~ "A faucet response url"
    & mapped.schema.example     ?~ "/account?address=00000000000000000000000000000000deadbeef"

instance ToSchema Transaction where
  declareNamedSchema proxy = genericDeclareNamedSchema stratoSchemaOptions proxy
    & mapped.schema.description ?~ "A transaction"
    & mapped.schema.example     ?~ toJSON ex
    where
      ex :: Transaction
      ex  = Transaction
          { transactionTransactionType = Transfer
          , transactionHash            = keccak256 "989ad6524e83e1a38b485bb898d27abbac65fc33905c3d3a2fd41c5bb91c3fc8"
          , transactionGasLimit        = Strung 90000000
          , transactionCodeOrData      = Just ""
          , transactionNonce           = Strung 123
          , transactionGasPrice        = Strung 50000000000
          , transactionTo              = Just (Address 0xdeadbeef)
          , transactionFrom            = Address 0xabba
          , transactionValue           = Strung 154
          , transactionFromBlock       = Just . Strung $ True
          , transactionBlockNumber     = Just 342
          , transactionR               = Hex 0xa90ee66c8faf6ce19a5e0496fc809cc1d6984d8636afc9c8a8b2ac381cabc014
          , transactionS               = Hex 0x5a5e4ac0d5b1d8cde2662075ee00ecd2da47faae2729252c92237057c6e5b32a
          , transactionV               = Hex 0x1c
          , transactionTimestamp       = Just (Strung (UTCTime (fromGregorian 2017 5 26) (secondsToDiffTime 123455)))
          , transactionOrigin          = "API"
          }

instance ToSchema TransactionType
instance ToSchema Block
instance ToSchema BlockData
instance ToSchema Account where
  declareNamedSchema proxy = genericDeclareNamedSchema stratoSchemaOptions proxy
    & mapped.schema.description ?~ "An account"
    & mapped.schema.example     ?~ toJSON ex
    where
      ex :: Account
      ex  = Account
          { accountAddress        = Address 0xdeadbeef
          , accountNonce          = Nonce 42
          , accountBalance        = Strung 123
          , accountContractRoot   = keccak256 "123"
          , accountKind           = "AddressStateRef"
          , accountCode           = "60606040526000357c01000000000000000000000000000000000000000000000000000000009004806360fe47b11460415780636d4ce63c14605757603f565b005b605560048080359060200190919050506078565b005b606260048050506086565b6040518082815260200191505060405180910390f35b806000600050819055505b50565b600060006000505490506094565b9056"
          , accountCodeHash       = keccak256 "989ad6524e83e1a38b485bb898d27b5dbc65fc33905c3d3a2fd41c5bb91c3fc8"
          , accountLatestBlockNum = 23
          , accountSource         = "pragma solidity ^0.4.8;\n\ncontract SimpleStorage {\n\n\tuint public myInt;\n\n\tfunction SimpleStorage(uint _myInt) {\n\t\tmyInt = _myInt;\n\t}\n}"
          }

instance ToSchema Difficulty
instance ToSchema TxCount
instance ToSchema Storage
instance ToSchema Word160 where
  declareNamedSchema = const . pure $ named "Word160" binarySchema
-- add min max
instance ToSchema Src where
  declareNamedSchema _ = do
             _ <- declareSchemaRef (Proxy :: Proxy Text)
             return $ NamedSchema (Just "Post Users Contract Request")
                 ( mempty
                 & type_ .~ SwaggerString
                 )

instance ToSchema SolcResponse
instance ToSchema AbiBin
instance ToSchema ExtabiResponse

instance ToParamSchema Keccak256 where
  toParamSchema _ = mempty & type_ .~ SwaggerString

instance ToSchema Natural where
  declareNamedSchema = const . pure $ named "Natural" $ sketchSchema (8 :: Natural)

instance ToParamSchema Natural where
  toParamSchema _ = mempty & type_ .~ SwaggerInteger

instance Show x => ToJSON (Strung x) where
  toJSON = toJSON . show . unStrung

instance Arbitrary x => Arbitrary (Strung x) where
  arbitrary = genericArbitrary uniform

data WithNext x = WithNext
  { withoutNext :: x
  , next        :: Text
  } deriving (Eq, Show, Generic)

instance FromJSON x => FromJSON (WithNext x) where
  parseJSON (value@(Object obj)) = do
    next <- obj .: "next"
    withoutNext <- parseJSON value
    return WithNext{..}
  parseJSON _ = fail "cannot parse WithNext"

instance ToJSON x => ToJSON (WithNext x) where
  toJSON (WithNext x next) = case toJSON x of
    Object obj -> Object (HashMap.insert "next" (toJSON next) obj)
    val        -> val -- object [ "next" .= next, "without_next" .= val ]

data TransactionType
  = Contract
  | FunctionCall
  | Transfer
  deriving (Eq, Show, Generic, FromJSON, ToJSON)

data Transaction = Transaction
  { transactionTransactionType :: TransactionType
  , transactionHash            :: Keccak256
  , transactionGasLimit        :: Strung Natural
  , transactionCodeOrData      :: Maybe Text
  , transactionGasPrice        :: Strung Natural
  , transactionTo              :: Maybe Address
  , transactionFrom            :: Address
  , transactionValue           :: Strung Natural
  , transactionFromBlock       :: Maybe (Strung Bool)
  , transactionBlockNumber     :: Maybe Int
  , transactionR               :: Hex Natural
  , transactionS               :: Hex Natural
  , transactionV               :: Hex Word8
  , transactionTimestamp       :: Maybe (Strung UTCTime)
  , transactionNonce           :: Strung Natural
  , transactionOrigin          :: Text
  } deriving (Eq, Show, Generic)

instance FromJSON Transaction where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance ToJSON Transaction where
  toJSON = genericToJSON (aesonPrefix camelCase)

data PostTransaction = PostTransaction
  { posttransactionHash       :: Keccak256
  , posttransactionGasLimit   :: Strung Natural
  , posttransactionCodeOrData :: Text
  , posttransactionGasPrice   :: Strung Natural
  , posttransactionTo         :: Maybe Address
  , posttransactionFrom       :: Address
  , posttransactionValue      :: Strung Natural
  , posttransactionR          :: Hex Natural
  , posttransactionS          :: Hex Natural
  , posttransactionV          :: Hex Word8
  , posttransactionNonce      :: Strung Natural
  } deriving (Eq, Show, Generic)

instance FromJSON PostTransaction where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance ToJSON PostTransaction where
  toJSON = genericToJSON (aesonPrefix camelCase)

instance Arbitrary PostTransaction where
  arbitrary = genericArbitrary uniform

instance ToSample PostTransaction where
  toSamples _ = singleSample PostTransaction
    { posttransactionHash = keccak256lazy (Binary.encode @ Integer 1)
    , posttransactionGasLimit = Strung 21000
    , posttransactionCodeOrData = ""
    , posttransactionGasPrice = Strung 50000000000
    , posttransactionTo = Just $ Address 0xdeadbeef
    , posttransactionFrom = Address 0x111dec89c25cbda1c12d67621ee3c10ddb8196bf
    , posttransactionValue = Strung 10000000000000000000
    , posttransactionR = Hex 1 -- make valid examples
    , posttransactionS = Hex 1 -- make valid examples
    , posttransactionV = Hex 0x1c
    , posttransactionNonce = Strung 0
    }

instance ToSchema PostTransaction where
  declareNamedSchema proxy = genericDeclareNamedSchema stratoSchemaOptions proxy
    & mapped.schema.description ?~ "Post Transaction"
    & mapped.schema.example ?~ toJSON ex
    where
      ex :: PostTransaction
      ex = PostTransaction
        { posttransactionHash = keccak256lazy (Binary.encode @ Integer 1)
        , posttransactionGasLimit = Strung 21000
        , posttransactionCodeOrData = ""
        , posttransactionGasPrice = Strung 50000000000
        , posttransactionTo = Just $ Address 0xdeadbeef
        , posttransactionFrom = Address 0x111dec89c25cbda1c12d67621ee3c10ddb8196bf
        , posttransactionValue = Strung 10000000000000000000
        , posttransactionR = Hex 1 -- make valid examples
        , posttransactionS = Hex 1 -- make valid examples
        , posttransactionV = Hex 0x1c
        , posttransactionNonce = Strung 0
        }


toPostTx :: Transaction -> PostTransaction
toPostTx Transaction{..} = PostTransaction
  { posttransactionHash = transactionHash
  , posttransactionGasLimit = transactionGasLimit
  , posttransactionCodeOrData = fromMaybe "" transactionCodeOrData
  , posttransactionGasPrice = transactionGasPrice
  , posttransactionTo = transactionTo
  , posttransactionFrom = transactionFrom
  , posttransactionValue = transactionValue
  , posttransactionR = transactionR
  , posttransactionS = transactionS
  , posttransactionV = transactionV
  , posttransactionNonce = transactionNonce
  }


data BlockData = BlockData
  { blockdataExtraData        :: Natural
  , blockdataGasUsed          :: Natural
  , blockdataGasLimit         :: Natural
  , blockdataKind             :: Text
  , blockdataUnclesHash       :: Keccak256
  , blockdataMixHash          :: Keccak256
  , blockdataReceiptsRoot     :: Text
  , blockdataNumber           :: Natural
  , blockdataDifficulty       :: Natural
  , blockdataTimestamp        :: UTCTime
  , blockdataCoinbase         :: Hex Natural
  , blockdataParentHash       :: Keccak256
  , blockdataNonce            :: Word64
  , blockdataStateRoot        :: Keccak256
  , blockdataTransactionsRoot :: Keccak256
  } deriving (Eq, Show, Generic)

instance FromJSON BlockData where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance ToJSON BlockData where
  toJSON = genericToJSON (aesonPrefix camelCase)

data Block = Block
  { blockKind                :: Text
  , blockBlockUncles         :: [BlockData]
  , blockReceiptTransactions :: [Transaction]
  , blockBlockData           :: BlockData
  } deriving (Eq, Show, Generic)

instance FromJSON Block where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance ToJSON Block where
  toJSON = genericToJSON (aesonPrefix camelCase)

data Account = Account
  { accountAddress        :: Address
  , accountNonce          :: Nonce --Strung Natural
  , accountKind           :: Text
  , accountBalance        :: Strung Natural
  , accountContractRoot   :: Keccak256
  , accountCode           :: Text
  , accountCodeHash       :: Keccak256
  , accountSource         :: Text
  , accountLatestBlockNum :: Natural
  } deriving (Eq, Show, Generic)

instance FromJSON Account where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance ToJSON Account where
  toJSON = genericToJSON (aesonPrefix camelCase)

newtype Difficulty = Difficulty { unDifficulty :: Integer }
  deriving (Eq, Show, Generic)

instance FromJSON Difficulty where
  parseJSON = withObject "Difficulty" $ \ obj ->
    Difficulty <$> obj .: "difficulty"

instance ToJSON Difficulty where
  toJSON (Difficulty dif) = object [ "difficulty" .= dif ]

newtype TxCount = TxCount { unTxCount :: Integer }
  deriving (Eq, Show, Generic)

instance FromJSON TxCount where
  parseJSON = withObject "TxCount" $ \ obj ->
    TxCount <$> obj .: "transactionCount"

instance ToJSON TxCount where
  toJSON (TxCount n) = object [ "transactionCount" .= n ]

data Storage = Storage
  { storageAddress :: Address
  , storageKey     :: Hex Word256
  , storageValue   :: Hex Word256
  } deriving (Eq, Show, Generic)

instance FromJSON Storage where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance ToJSON Storage where
  toJSON = genericToJSON (aesonPrefix camelCase)

newtype Src = Src { unSrc :: Text } deriving (Eq, Show)

instance ToForm Src where
  toForm (Src src) = Form $ HashMap.singleton "src" [src]

newtype ExtabiResponse = ExtabiResponse { extabiresponseSrc :: Map Text Xabi }
  deriving (Eq, Show, Generic)

instance FromJSON ExtabiResponse where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance ToJSON ExtabiResponse where
  toJSON = genericToJSON (aesonPrefix camelCase)

instance MimeUnrender PlainText ExtabiResponse where
  mimeUnrender _ = eitherDecode

instance FromJSON FaucetResponse where
  parseJSON = fmap FaucetResponse . parseJSON
instance ToJSON FaucetResponse where
  toJSON (FaucetResponse x) = toJSON x

instance MimeRender PlainText ExtabiResponse where
  mimeRender _ = encode

instance MimeUnrender PlainText FaucetResponse where
  mimeUnrender _ =
    return . FaucetResponse . Text.decodeUtf8 . Lazy.toStrict

instance MimeRender PlainText FaucetResponse where
  mimeRender _ (FaucetResponse x) =
    Lazy.fromStrict $ Text.encodeUtf8 x

newtype SolcResponse = SolcResponse { solcresponseSrc :: Map Text AbiBin }
                     deriving (Eq,Show,Generic)

instance FromJSON SolcResponse where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance ToJSON SolcResponse where
  toJSON = genericToJSON (aesonPrefix camelCase)

data AbiBin = AbiBin
  { abi        :: Text
  , bin        :: Text
  , binRuntime :: Text
  } deriving (Eq,Show,Generic)

instance FromJSON AbiBin where
  parseJSON = withObject "AbiBin" $ \obj -> AbiBin
    <$> obj .: "abi"
    <*> obj .: "bin"
    <*> obj .: "bin-runtime"

instance ToJSON AbiBin where
  toJSON AbiBin{..} = object
    [ "abi" .= abi
    , "bin" .= bin
    , "bin-runtime" .= binRuntime
    ]

instance MimeUnrender PlainText SolcResponse where
  mimeUnrender _ = eitherDecode

instance MimeRender PlainText SolcResponse where
  mimeRender _ = encode

data TransactionResult = TransactionResult
  { transactionresultBlockHash        :: Keccak256
  , transactionresultTransactionHash  :: Keccak256
  , transactionresultMessage          :: Text
  , transactionresultResponse         :: Text
  , transactionresultTrace            :: Text
  , transactionresultGasUsed          :: Hex Word256
  , transactionresultEtherUsed        :: Hex Word256
  , transactionresultContractsCreated :: Text
  , transactionresultContractsDeleted :: Text
  , transactionresultStateDiff        :: Text
  , transactionresultTime             :: Double
  , transactionresultNewStorage       :: Text
  , transactionresultDeletedStorage   :: Text
  } deriving (Show, Generic, Eq)

instance Arbitrary TransactionResult where
  arbitrary = genericArbitrary uniform

instance ToJSON TransactionResult where
  toJSON = genericToJSON (aesonPrefix camelCase)

instance FromJSON TransactionResult where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance ToSchema TransactionResult where
  declareNamedSchema proxy = genericDeclareNamedSchema stratoSchemaOptions proxy
    & mapped.schema.description ?~ "Transaction Result"
    & mapped.schema.example ?~ toJSON ex
    where ex = exampleTxResult

exampleTxResult :: TransactionResult
exampleTxResult = TransactionResult (keccak256 "blockHask") (keccak256 "txhash") "I'm a tx result message" "I'm a tx result response" "tx trace" (Hex 0xFFFFFFFFFFFFFFFF) (Hex 0x000000000000000A)  "[MyNewContractA, MyNewContractB]" "[MyOldContract]" "I am a state Diff" 0.2321 "New Storage" "Deleted Storage"

stratoSchemaOptions :: SchemaOptions
stratoSchemaOptions = defaultSchemaOptions {fieldLabelModifier = camelCase . dropFPrefix}

newtype BatchTransactionResult = BatchTransactionResult
    { unBatchTransactionResult :: Map Keccak256 [TransactionResult]
    } deriving (Eq, Show, Generic, ToSchema)

instance ToJSON BatchTransactionResult where
    toJSON = toJSON . unBatchTransactionResult

instance FromJSON BatchTransactionResult where
    parseJSON = fmap BatchTransactionResult . parseJSON
