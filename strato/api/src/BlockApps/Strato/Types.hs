{-# LANGUAGE
    DataKinds
  , DeriveAnyClass
  , DeriveGeneric
  , MultiParamTypeClasses
  , OverloadedStrings
  , RecordWildCards
  , TypeApplications
#-}

module BlockApps.Strato.Types
  ( Hex (..)
  , Strung (..)
  , Address (..)
  , addressString
  , stringAddress
  , Addresses (..)
  , Keccak256 (..)
  , WithNext (..)
  , TransactionType (..)
  , Transaction (..)
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
  ) where

import Control.Applicative
import Data.Aeson
import Data.Aeson.Casing
import qualified Data.Binary as Binary
import Data.Foldable
import qualified Data.HashMap.Strict as HashMap
import Data.LargeWord
import Data.List.NonEmpty (NonEmpty)
import Data.Map.Strict (Map)
import Data.Maybe
import Data.Text (Text)
import qualified Data.Text as Text
import Data.Time
import Data.Word
import Generic.Random.Generic
import GHC.Generics
import Numeric
import Numeric.Natural
import Servant.API
import Servant.Docs
import Test.QuickCheck
import Test.QuickCheck.Instances ()
import Text.Read
import Text.Read.Lex
import Web.HttpApiData
import Web.FormUrlEncoded hiding (fieldLabelModifier)

import BlockApps.Ethereum
  ( Address (..)
  , addressString
  , stringAddress
  , Keccak256 (..)
  , keccak256lazy
  )
import BlockApps.Solidity

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
      Just n -> return $ Hex n
instance (Integral n, Show n) => ToJSON (Hex n) where
  toJSON = toJSON . show
instance (Integral n, Show n) => ToHttpApiData (Hex n) where
  toUrlPiece = Text.pack . show
instance Arbitrary x => Arbitrary (Hex x) where
  arbitrary = genericArbitrary uniform

-- hack to deal with weird `ToJSON`s
newtype Strung x = Strung { unStrung :: x } deriving (Eq, Show, Generic)
instance (FromJSON x, Read x) => FromJSON (Strung x) where
  parseJSON value = Strung <$> parseJSON value <|> do
    string <- parseJSON value
    case readMaybe string of
      Nothing -> fail $ "cannot decode Strung: " ++ string
      Just y -> return $ Strung y
instance Show x => ToJSON (Strung x) where
  toJSON = toJSON . show . unStrung
instance Arbitrary x => Arbitrary (Strung x) where
  arbitrary = genericArbitrary uniform

newtype Addresses = Addresses { unAddresses :: NonEmpty (Hex Word160) }
  deriving (Eq, Show, Generic)
instance ToForm Addresses where
  toForm (Addresses hexes) = Form $ HashMap.singleton "addresses"
    [Text.pack . show . map (\(Hex n) -> showHex n "") $ toList hexes]

data WithNext x = WithNext
  { withoutNext :: x
  , next :: Text
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
    val -> object [ "next" .= next, "without_next" .= val ]

data TransactionType
  = Contract
  | FunctionCall
  | Transfer
  deriving (Eq, Show, Generic, FromJSON, ToJSON)

data Transaction = Transaction
  { transactionTransactionType :: TransactionType
  , transactionHash :: Keccak256
  , transactionGasLimit :: Strung Natural
  , transactionCodeOrData :: Maybe Text
  , transactionGasPrice :: Strung Natural
  , transactionTo :: Maybe Address
  , transactionFrom :: Address
  , transactionValue :: Strung Natural
  , transactionFromBlock :: Maybe (Strung Bool)
  , transactionBlockNumber :: Maybe Int
  , transactionR :: Hex Natural
  , transactionS :: Hex Natural
  , transactionV :: Hex Word8
  , transactionTimestamp :: Maybe (Strung UTCTime)
  , transactionNonce :: Strung Natural
  } deriving (Eq, Show, Generic)
instance FromJSON Transaction where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance ToJSON Transaction where
  toJSON = genericToJSON (aesonPrefix camelCase)

data PostTransaction = PostTransaction
  { posttransactionHash :: Keccak256
  , posttransactionGasLimit :: Strung Natural
  , posttransactionCodeOrData :: Text
  , posttransactionGasPrice :: Strung Natural
  , posttransactionTo :: Maybe Address
  , posttransactionFrom :: Address
  , posttransactionValue :: Strung Natural
  , posttransactionR :: Hex Natural
  , posttransactionS :: Hex Natural
  , posttransactionV :: Hex Word8
  , posttransactionNonce :: Strung Natural
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
  { blockdataExtraData :: Natural
  , blockdataGasUsed :: Natural
  , blockdataGasLimit :: Natural
  , blockdataKind :: Text
  , blockdataUnclesHash :: Keccak256
  , blockdataMixHash :: Keccak256
  , blockdataReceiptsRoot :: Text
  , blockdataNumber :: Natural
  , blockdataDifficulty :: Natural
  , blockdataTimestamp :: UTCTime
  , blockdataCoinbase :: Hex Natural
  , blockdataParentHash :: Keccak256
  , blockdataNonce :: Word64
  , blockdataStateRoot :: Keccak256
  , blockdataTransactionsRoot :: Keccak256
  } deriving (Eq, Show, Generic)
instance FromJSON BlockData where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance ToJSON BlockData where
  toJSON = genericToJSON (aesonPrefix camelCase)

data Block = Block
  { blockKind :: Text
  , blockBlockUncles :: [BlockData]
  , blockReceiptTransactions :: [Transaction]
  , blockBlockData :: BlockData
  } deriving (Eq, Show, Generic)
instance FromJSON Block where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance ToJSON Block where
  toJSON = genericToJSON (aesonPrefix camelCase)

data Account = Account
  { accountAddress :: Address
  , accountNonce :: Natural
  , accountBalance :: Strung Natural
  , accountContractRoot :: Keccak256
  , accountCode :: Keccak256
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
  { storageAddressStateRefId :: Int
  , storageKey :: Hex Word256
  , storageValue :: Hex Word256
  } deriving (Eq, Show, Generic)
instance FromJSON Storage where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance ToJSON Storage where
  toJSON = genericToJSON (aesonPrefix camelCase)

newtype Src = Src { unSrc :: Text } deriving (Eq, Show)
instance ToForm Src where
  toForm (Src src) = Form $ HashMap.singleton "src" [src]

newtype ExtabiResponse = ExtabiResponse { extabiresponseSrc :: Map Text Xabi }
  deriving (Eq,Show,Generic)
instance FromJSON ExtabiResponse where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance ToJSON ExtabiResponse where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance MimeUnrender PlainText ExtabiResponse where
  mimeUnrender _ = eitherDecode
instance MimeRender PlainText ExtabiResponse where
  mimeRender _ = encode

data SolcResponse = SolcResponse
  { solcresponseSrc :: Map Text AbiBin }
  deriving (Eq,Show,Generic)
instance FromJSON SolcResponse where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance ToJSON SolcResponse where
  toJSON = genericToJSON (aesonPrefix camelCase)
data AbiBin = AbiBin
  { abi :: Text
  , bin :: Text
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
