{-# LANGUAGE
    DataKinds
  , DeriveAnyClass
  , DeriveGeneric
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
  ) where

import Control.Applicative
import Data.Aeson
import Data.Aeson.Types
import qualified Data.Binary as Binary
import Data.Foldable
import qualified Data.HashMap.Strict as HashMap
import Data.LargeWord
import Data.List
import Data.List.NonEmpty (NonEmpty)
import Data.Maybe
import Data.Text (Text)
import qualified Data.Text as Text
import Data.Time
import Data.Word
import Generic.Random.Generic
import GHC.Generics
import Numeric
import Numeric.Natural
import Servant.Docs
import Test.QuickCheck
import Test.QuickCheck.Instances ()
import Text.Read
import Text.Read.Lex
import Web.HttpApiData
import Web.FormUrlEncoded hiding (fieldLabelModifier)

import BlockApps.Data
  ( Address (..)
  , addressString
  , stringAddress
  , Keccak256 (..)
  , keccak256lazy
  )

newtype Hex n = Hex { unHex :: n } deriving (Eq, Generic)
instance (Integral n, Show n) => Show (Hex n) where
  show (Hex n) = showHex n ""
instance (Eq n, Num n) => Read (Hex n) where
  readPrec = Hex <$> readP_to_Prec (\ _d -> readHexP)
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
instance Arbitrary x => Arbitrary (Hex x) where arbitrary = genericArbitrary

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
instance Arbitrary x => Arbitrary (Strung x) where arbitrary = genericArbitrary

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
  { tx_transactionType :: TransactionType
  , tx_hash :: Keccak256
  , tx_gasLimit :: Strung Natural
  , tx_codeOrData :: Maybe Text
  , tx_gasPrice :: Strung Natural
  , tx_to :: Maybe Address
  , tx_from :: Address
  , tx_value :: Strung Natural
  , tx_fromBlock :: Maybe (Strung Bool)
  , tx_blockNumber :: Maybe Int
  , tx_r :: Hex Natural
  , tx_s :: Hex Natural
  , tx_v :: Hex Word8
  , tx_timestamp :: Maybe (Strung UTCTime)
  , tx_nonce :: Strung Natural
  } deriving (Eq, Show, Generic)
instance FromJSON Transaction where
  parseJSON = genericParseJSON
    defaultOptions{ fieldLabelModifier = idOrStripPrefix "tx_" }
instance ToJSON Transaction where
  toJSON = genericToJSON
    defaultOptions{ fieldLabelModifier = idOrStripPrefix "tx_" }

data PostTransaction = PostTransaction
  { ptx_hash :: Keccak256
  , ptx_gasLimit :: Strung Natural
  , ptx_codeOrData :: Text
  , ptx_gasPrice :: Strung Natural
  , ptx_to :: Maybe Address
  , ptx_from :: Address
  , ptx_value :: Strung Natural
  , ptx_r :: Hex Natural
  , ptx_s :: Hex Natural
  , ptx_v :: Hex Word8
  , ptx_nonce :: Strung Natural
  } deriving (Eq, Show, Generic)
instance FromJSON PostTransaction where
  parseJSON = genericParseJSON
    defaultOptions{ fieldLabelModifier = idOrStripPrefix "ptx_" }
instance ToJSON PostTransaction where
  toJSON = genericToJSON
    defaultOptions{ fieldLabelModifier = idOrStripPrefix "ptx_" }
instance Arbitrary PostTransaction where arbitrary = genericArbitrary
instance ToSample PostTransaction where
  toSamples _ = singleSample PostTransaction
    { ptx_hash = keccak256lazy (Binary.encode @ Integer 1)
    , ptx_gasLimit = Strung 21000
    , ptx_codeOrData = ""
    , ptx_gasPrice = Strung 50000000000
    , ptx_to = Just $ Address 0xdeadbeef
    , ptx_from = Address 0x111dec89c25cbda1c12d67621ee3c10ddb8196bf
    , ptx_value = Strung 10000000000000000000
    , ptx_r = Hex 1 -- make valid examples
    , ptx_s = Hex 1 -- make valid examples
    , ptx_v = Hex 0x1c
    , ptx_nonce = Strung 0
    }

toPostTx :: Transaction -> PostTransaction
toPostTx Transaction{..} = PostTransaction
  { ptx_hash = tx_hash
  , ptx_gasLimit = tx_gasLimit
  , ptx_codeOrData = fromMaybe "" tx_codeOrData
  , ptx_gasPrice = tx_gasPrice
  , ptx_to = tx_to
  , ptx_from = tx_from
  , ptx_value = tx_value
  , ptx_r = tx_r
  , ptx_s = tx_s
  , ptx_v = tx_v
  , ptx_nonce = tx_nonce
  }

data BlockData = BlockData
  { blockData_extraData :: Natural
  , blockData_gasUsed :: Natural
  , blockData_gasLimit :: Natural
  , blockData_kind :: Text
  , blockData_unclesHash :: Keccak256
  , blockData_mixHash :: Keccak256
  , blockData_receiptsRoot :: Text
  , blockData_number :: Natural
  , blockData_difficulty :: Natural
  , blockData_timestamp :: UTCTime
  , blockData_coinbase :: Hex Natural
  , blockData_parentHash :: Keccak256
  , blockData_nonce :: Word64
  , blockData_stateRoot :: Keccak256
  , blockData_transactionsRoot :: Keccak256
  } deriving (Eq, Show, Generic)
instance FromJSON BlockData where
  parseJSON = genericParseJSON
    defaultOptions{ fieldLabelModifier = idOrStripPrefix "blockData_" }
instance ToJSON BlockData where
  toJSON = genericToJSON
    defaultOptions{ fieldLabelModifier = idOrStripPrefix "blockData_" }

data Block = Block
  { block_kind :: Text
  , block_blockUncles :: [BlockData]
  , block_receiptTransactions :: [Transaction]
  , block_blockData :: BlockData
  } deriving (Eq, Show, Generic)
instance FromJSON Block where
  parseJSON = genericParseJSON
    defaultOptions{ fieldLabelModifier = idOrStripPrefix "block_" }
instance ToJSON Block where
  toJSON = genericToJSON
    defaultOptions{ fieldLabelModifier = idOrStripPrefix "block_" }

data Account = Account
  { acct_address :: Address
  , acct_nonce :: Natural
  , acct_balance :: Strung Natural
  , acct_contractRoot :: Keccak256
  , acct_code :: Keccak256
  , acct_latestBlockNum :: Natural
  } deriving (Eq, Show, Generic)
instance FromJSON Account where
  parseJSON = genericParseJSON defaultOptions{ fieldLabelModifier = dropAcct }
    where
      dropAcct string = fromMaybe string (stripPrefix "acct_" string)
instance ToJSON Account where
  toJSON = genericToJSON defaultOptions{ fieldLabelModifier = dropAcct }
    where
      dropAcct string = fromMaybe string (stripPrefix "acct_" string)

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
  { str_addressStateRefId :: Int
  , str_key :: Hex Word256
  , str_value :: Hex Word256
  } deriving (Eq, Show, Generic)
instance FromJSON Storage where
  parseJSON = genericParseJSON
    defaultOptions{ fieldLabelModifier = idOrStripPrefix "str_" }
instance ToJSON Storage where
  toJSON = genericToJSON
    defaultOptions{ fieldLabelModifier = idOrStripPrefix "str_" }

newtype Src = Src { unSrc :: Text } deriving (Eq, Show)
instance ToForm Src where
  toForm (Src src) = Form $ HashMap.singleton "src" [src]

-- helpers
idOrStripPrefix :: String -> String -> String
idOrStripPrefix prefix string = fromMaybe string $ stripPrefix prefix string
