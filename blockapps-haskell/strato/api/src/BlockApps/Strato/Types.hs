{-# LANGUAGE DataKinds             #-}
{-# LANGUAGE DeriveAnyClass        #-}
{-# LANGUAGE DeriveGeneric         #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE RecordWildCards       #-}
{-# LANGUAGE ScopedTypeVariables   #-}
{-# LANGUAGE TypeApplications      #-}
{-# LANGUAGE TypeSynonymInstances  #-}

{-# OPTIONS_GHC -fno-warn-missing-methods #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module BlockApps.Strato.Types
  ( Strung (..)
  , Address (..)
  , addressString
  , stringAddress
  , ChainId (..)
  , Keccak256 (..)
  , WithNext (..)
  , TransactionType (..)
  , Transaction (..)
  , TransactionResult (..)
  , BatchTransactionResult (..)
  , PostTransaction (..)
  , defaultPostTx
  , toPostTx
  , BlockData (..)
  , Block (..)
  , Account (..)
  , Difficulty (..)
  , TxCount (..)
  , Storage (..)
  , AbiBin (..)
  , exampleTxResult
  , ChainInfo (..)
  , UnsignedChainInfo (..)
  , ChainSignature (..)
  , ChainIdChainInfo
  , creationBlockHash
  ) where

import           Control.Applicative
import           Control.Lens                 (mapped, (&), (.~), (?~))
import           Data.Aeson
import           Data.Aeson.Casing
import           Data.Aeson.Casing.Internal   (dropFPrefix)
import qualified Data.Binary                  as Binary
import qualified Data.HashMap.Strict          as HashMap
import           Data.LargeWord
import           Data.Map.Strict              (Map)
import qualified Data.Map.Strict              as M
import           Data.Maybe
import           Data.Monoid                  ((<>))
import           Data.Proxy
import           Data.Swagger
import qualified Data.Swagger                 as Sw
import           Data.Swagger.Internal.Schema (named, sketchSchema)
import           Data.Text                    (Text)
import qualified Data.Text                    as Text
import           Data.Time
import           Data.Word
import qualified Generic.Random               as GR
import           GHC.Generics
import           Numeric
import           Numeric.Natural
import           Servant.API
import           Servant.Docs
import           Test.QuickCheck
import           Test.QuickCheck.Instances    ()
import           Text.Read
import           BlockApps.Ethereum           (Hex (..), Address (..), ChainId (..),
                                               Keccak256 (..), Nonce (..),
                                               addressString, keccak256,
                                               stringKeccak256,
                                               keccak256lazy, stringAddress,
                                               AccountInfo(..), CodeInfo(..),
                                               stringChainId)
import           BlockApps.Strato.TypeLits

instance (ToHttpApiData a) => ToHttpApiData [a] where
  toUrlPiece = Text.pack . show . map toUrlPiece

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
          , transactionChainId         = Nothing
          , transactionMetadata        = Nothing
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
          , accountChainId        = Nothing
          , accountLatestBlockNum = 23
          }

instance ToSchema Difficulty
instance ToSchema TxCount
instance ToSchema Storage
instance ToSchema Word160 where
  declareNamedSchema = const . pure $ named "Word160" binarySchema
-- add min max

instance ToSchema AbiBin

instance ToParamSchema Word256 where
  toParamSchema _ = mempty & type_ .~ SwaggerString

instance ToHttpApiData Word256 where
  toUrlPiece = Text.pack . ("0x" ++ ) . flip showHex ""

instance FromHttpApiData Word256 where
  parseUrlPiece text = case readMaybe (Text.unpack text) of
    Nothing      -> Left $ "Could not decode Word256: " <> text
    Just (Hex w256) -> Right w256

instance ToParamSchema Keccak256 where
  toParamSchema _ = mempty & type_ .~ SwaggerString

instance Show x => ToJSON (Strung x) where
  toJSON = toJSON . show . unStrung

instance Arbitrary x => Arbitrary (Strung x) where
  arbitrary = GR.genericArbitrary GR.uniform

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
  , transactionMetadata        :: Maybe (Map Text Text)
  , transactionTimestamp       :: Maybe (Strung UTCTime)
  , transactionNonce           :: Strung Natural
  , transactionOrigin          :: Text
  , transactionChainId         :: Maybe ChainId
  } deriving (Eq, Show, Generic)

instance FromJSON Transaction where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance ToJSON Transaction where
  toJSON = genericToJSON (aesonPrefix camelCase)

data PostTransaction = PostTransaction
  { posttransactionHash       :: Keccak256
  , posttransactionGasLimit   :: Natural
  , posttransactionCodeOrData :: Text
  , posttransactionGasPrice   :: Natural
  , posttransactionTo         :: Maybe Address
  , posttransactionFrom       :: Address
  , posttransactionValue      :: Strung Natural
  , posttransactionR          :: Hex Natural
  , posttransactionS          :: Hex Natural
  , posttransactionV          :: Hex Word8
  , posttransactionNonce      :: Natural
  , posttransactionChainId    :: Maybe ChainId
  , posttransactionMetadata   :: Maybe (Map Text Text)
  } deriving (Eq, Show, Generic)

instance FromJSON PostTransaction where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance ToJSON PostTransaction where
  toJSON = genericToJSON (aesonPrefix camelCase)

instance Arbitrary PostTransaction where
  arbitrary = GR.genericArbitrary GR.uniform

instance ToSample PostTransaction where
  toSamples _ = singleSample defaultPostTx

defaultPostTx :: PostTransaction -- TODO: Make this a real default
defaultPostTx = PostTransaction
    { posttransactionHash = keccak256lazy (Binary.encode @ Integer 1)
    , posttransactionGasLimit = 21000
    , posttransactionCodeOrData = ""
    , posttransactionGasPrice = 50000000000
    , posttransactionTo = Just $ Address 0xdeadbeef
    , posttransactionFrom = Address 0x111dec89c25cbda1c12d67621ee3c10ddb8196bf
    , posttransactionValue = Strung 10000000000000000000
    , posttransactionR = Hex 1 -- make valid examples
    , posttransactionS = Hex 1 -- make valid examples
    , posttransactionV = Hex 0x1c
    , posttransactionNonce = 0
    , posttransactionChainId = Nothing
    , posttransactionMetadata = Nothing
    }

instance ToSchema PostTransaction where
  declareNamedSchema proxy = genericDeclareNamedSchema stratoSchemaOptions proxy
    & mapped.schema.description ?~ "Post Transaction"
    & mapped.schema.example ?~ toJSON defaultPostTx

toPostTx :: Transaction -> PostTransaction
toPostTx Transaction{..} = PostTransaction
  { posttransactionHash = transactionHash
  , posttransactionGasLimit = unStrung transactionGasLimit
  , posttransactionCodeOrData = fromMaybe "" transactionCodeOrData
  , posttransactionGasPrice = unStrung transactionGasPrice
  , posttransactionTo = transactionTo
  , posttransactionFrom = transactionFrom
  , posttransactionValue = transactionValue
  , posttransactionR = transactionR
  , posttransactionS = transactionS
  , posttransactionV = transactionV
  , posttransactionNonce = unStrung transactionNonce
  , posttransactionChainId = transactionChainId
  , posttransactionMetadata = transactionMetadata
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
  , blockdataChainId          :: Maybe ChainId
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
  , accountChainId        :: Maybe ChainId
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
  , storageChainId :: Maybe ChainId
  } deriving (Eq, Show, Generic)

instance FromJSON Storage where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance ToJSON Storage where
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
  , transactionresultChainId          :: Maybe ChainId
  } deriving (Show, Generic, Eq)

instance Arbitrary TransactionResult where
  arbitrary = GR.genericArbitrary GR.uniform

instance ToJSON TransactionResult where
  toJSON = genericToJSON (aesonPrefix camelCase)

-- The toJSON instance without Word256 values (their conversion is extremely slow)
  -- toJSON TransactionResult{..} = object
  --   [ "blockHash" .= transactionresultBlockHash
  --   , "transactionHash" .= transactionresultTransactionHash
  --   , "message" .= transactionresultMessage
  --   , "response" .= transactionresultResponse
  --   , "trace" .= transactionresultTrace
  --   , "contractsCreated" .= transactionresultContractsCreated
  --   , "contractsDeleted" .= transactionresultContractsDeleted
  --   , "stateDiff" .= transactionresultStateDiff
  --   , "time" .= transactionresultTime
  --   , "newStorage" .= transactionresultNewStorage
  --   , "deletedStorage" .= transactionresultDeletedStorage
  --   ]

instance FromJSON TransactionResult where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance ToSchema TransactionResult where
  declareNamedSchema proxy = genericDeclareNamedSchema stratoSchemaOptions proxy
    & mapped.schema.description ?~ "Transaction Result"
    & mapped.schema.example ?~ toJSON ex
    where ex = exampleTxResult

exampleTxResult :: TransactionResult
exampleTxResult = TransactionResult (keccak256 "blockHask") (keccak256 "txhash") "I'm a tx result message" "I'm a tx result response" "tx trace" (Hex 0xFFFFFFFFFFFFFFFF) (Hex 0x000000000000000A)  "[MyNewContractA, MyNewContractB]" "[MyOldContract]" "I am a state Diff" 0.2321 "New Storage" "Deleted Storage" Nothing

stratoSchemaOptions :: SchemaOptions
stratoSchemaOptions = defaultSchemaOptions {Sw.fieldLabelModifier = camelCase . dropFPrefix}

newtype BatchTransactionResult = BatchTransactionResult
    { unBatchTransactionResult :: Map Keccak256 [TransactionResult]
    } deriving (Eq, Show, Generic, ToSchema)

instance ToJSON BatchTransactionResult where
    toJSON = toJSON . unBatchTransactionResult

instance FromJSON BatchTransactionResult where
    parseJSON = fmap BatchTransactionResult . parseJSON

data UnsignedChainInfo = UnsignedChainInfo
  { chainLabel    :: !Text
  , accountInfo   :: ![AccountInfo]
  , codeInfo      :: ![CodeInfo]
  , members       :: !(NamedMap "address" Address "enode" Text)
  , parentChain   :: !(Maybe ChainId)
  , creationBlock :: !Keccak256
  , chainNonce    :: !Word256
  , chainMetadata :: !(Map Text Text)
  } deriving (Eq, Show, Generic)

exampleUnsignedChainInfo :: UnsignedChainInfo
exampleUnsignedChainInfo = UnsignedChainInfo
  { chainLabel = "myChain"
  , accountInfo =
      [ (NonContract (Address 0x5815b9975001135697b5739956b9a6c87f1c575c) (2000 :: Integer))
      , (NonContract (Address 0x93fdd1d21502c4f87295771253f5b71d897d911c) (400000 :: Integer))
      ]
  , codeInfo = []
  , members = map fromTuple
      [ ( Address 0x5815b9975001135697b5739956b9a6c87f1c575c
        , "enode://6d8a80d14311c39f35f516fa664deaaaa13e85b2f7493f37f6144d86991ec012937307647bd3b9a82abe2974e1407241d54947bbb39763a4cac9f77166ad92a0@171.16.0.4:30303"
          :: Text
        )
      , ( Address 0x93fdd1d21502c4f87295771253f5b71d897d911c
        , "enode://6f8a80d14311c39f35f516fa664deaaaa13e85b2f7493f37f6144d86991ec012937307647bd3b9a82abe2974e1407241d54947bbb39763a4cac9f77166ad92a0@172.16.0.5:30303?discport=30303"
          :: Text
        )
      ]
  , parentChain = Nothing
  , creationBlock = creationBlockHash
  , chainNonce = 0x5a5e4ac0d5b1d8cde2662075ee00ecd2da47faae2729252c92237057c6e5b32a
  , chainMetadata = M.empty
  }

instance ToSchema UnsignedChainInfo where
  declareNamedSchema proxy = genericDeclareNamedSchema stratoSchemaOptions proxy
    & mapped.schema.description ?~ "UnsignedChainInfo"

data ChainSignature = ChainSignature
  { chainR        :: !(Hex Natural)
  , chainS        :: !(Hex Natural)
  , chainV        :: !(Hex Word8)
  } deriving (Eq, Show, Generic)

exampleChainSignature :: ChainSignature
exampleChainSignature = ChainSignature
  { chainR = Hex 0
  , chainS = Hex 0
  , chainV = Hex 0x1b
  }

instance ToSchema ChainSignature where
  declareNamedSchema proxy = genericDeclareNamedSchema stratoSchemaOptions proxy
    & mapped.schema.description ?~ "ChainSignature"
    & mapped.schema.example ?~ toJSON exampleChainSignature

instance FromJSON ChainSignature where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance ToJSON ChainSignature where
  toJSON = genericToJSON (aesonPrefix camelCase)

data ChainInfo = ChainInfo
  { chainInfo      :: !(UnsignedChainInfo)
  , chainSignature :: !(Maybe ChainSignature)
  } deriving (Eq, Show, Generic)

creationBlockHash :: Keccak256
creationBlockHash = fromJust $
  stringKeccak256 "0000000000000000000000000000000000000000000000000000000000000000"

instance ToSchema (NamedTuple "address" Address "enode" Text) where
  declareNamedSchema proxy = genericDeclareNamedSchema stratoSchemaOptions proxy
    & mapped.schema.description ?~ "address and enode pair"
    & mapped.schema.example ?~ toJSON
      ((NamedTuple
        ( Address 0x5815b9975001135697b5739956b9a6c87f1c575c
        , "enode://6d8a80d14311c39f35f516fa664deaaaa13e85b2f7493f37f6144d86991ec012937307647bd3b9a82abe2974e1407241d54947bbb39763a4cac9f77166ad92a0@171.16.0.4:30303"
          :: Text
        )
       ) :: NamedTuple "address" Address "enode" Text
      )

exampleChainInfo :: ChainInfo
exampleChainInfo = ChainInfo
  { chainInfo = exampleUnsignedChainInfo
  , chainSignature = Just exampleChainSignature
  }

instance ToSchema ChainInfo where
  declareNamedSchema proxy = genericDeclareNamedSchema stratoSchemaOptions proxy
    & mapped.schema.description ?~ "ChainInfo"
    & mapped.schema.example ?~ toJSON exampleChainInfo

instance FromJSON ChainInfo where
  parseJSON (Object o) = do
    l <- o .: "label"
    as <- o .: "accountInfo"
    cs <- o .: "codeInfo"
    ms <- o .: "members"
    pc <- o .:? "parentChain"
    cb <- o .: "creationBlock"
    cn <- (o .: "nonce")
    md <- o .: "metadata"
    sig <- o .:? "signature"
    return $ ChainInfo (UnsignedChainInfo l as cs ms pc cb cn md) sig
  parseJSON x = error $ "couldn't parse JSON for chain info: " ++ show x

instance ToJSON ChainInfo where
  toJSON (ChainInfo (UnsignedChainInfo cl ai ci ms pc cb cn md) sig) =
    object [ "label" .= cl
           , "accountInfo" .= ai
           , "codeInfo" .= ci
           , "members" .= ms
           , "parentChain" .= pc
           , "creationBlock" .= cb
           , "nonce" .= cn
           , "metadata" .= md
           , "signature" .= sig
           ]

type ChainIdChainInfo = NamedTuple "id" ChainId "info" ChainInfo

instance ToSchema ChainIdChainInfo where
  declareNamedSchema proxy = genericDeclareNamedSchema stratoSchemaOptions proxy
    & mapped.schema.description ?~ "chainid and chaininfo pair"
    & mapped.schema.example ?~ toJSON ((NamedTuple (fromJust $ stringChainId "ec41a0a4da1f33ee9a757f4fd27c2a1a57313353375860388c66edc562ddc781", exampleChainInfo)) :: ChainIdChainInfo)
