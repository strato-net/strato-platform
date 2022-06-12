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


--{-# OPTIONS_GHC -fno-warn-unused-top-binds #-}

module BlockApps.Strato.Types
  ( Strung (..)
  , PostTransaction (..)
  
--  , defaultPostTx
  
  , Storage (..)
  , StorageKV (..)
  , AbiBin (..)
  ) where

import           Control.Applicative
import           Control.Lens                 (mapped, (&), (?~))
import           Control.Monad
import           Data.Aeson
import           Data.Aeson.Casing
import           Data.Aeson.Casing.Internal   (dropFPrefix)
import           Data.Aeson.Types
import qualified Data.Binary                  as Binary
import qualified Data.ByteString.Lazy         as BL
import           Data.Map.Strict              (Map)
import           Data.Proxy
import           Data.Swagger
import qualified Data.Swagger                 as Sw
import           Data.Swagger.Internal.Schema (named)
import           Data.Text                    (Text)
import qualified Data.Text                    as Text
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
-- TODO: Unify Bloch and Strato transactions
import           BlockApps.Ethereum
import           Blockchain.SolidVM.Model
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.ChainId
import           Blockchain.Strato.Model.ExtendedWord
import           Blockchain.Strato.Model.Keccak256

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

instance ToSchema x => ToSchema (Strung x) where
  declareNamedSchema _ = declareNamedSchema (Proxy :: Proxy x)

instance ToSchema Word160 where
  declareNamedSchema = const . pure $ named "Word160" binarySchema
-- add min max

instance ToSchema AbiBin

instance ToParamSchema Word256 where
  toParamSchema _ = mempty & type_ ?~ SwaggerString

instance ToHttpApiData Word256 where
  toUrlPiece = Text.pack . ("0x" ++ ) . flip showHex ""

instance FromHttpApiData Word256 where
  parseUrlPiece text = case readMaybe (Text.unpack text) of
    Nothing      -> Left $ "Could not decode Word256: " <> text
    Just (Hex w256) -> Right w256

instance Show x => ToJSON (Strung x) where
  toJSON = toJSON . show . unStrung

instance Arbitrary x => Arbitrary (Strung x) where
  arbitrary = GR.genericArbitrary GR.uniform

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
    { posttransactionHash = hash $ BL.toStrict (Binary.encode @ Integer 1)
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

data StorageKV = EVMEntry (Hex Word256) (Hex Word256)
               | SolidVMEntry HexStorage HexStorage
               deriving (Eq, Show, Generic, ToSchema)

instance Arbitrary StorageKV where
  arbitrary = liftM2 EVMEntry arbitrary arbitrary

data Storage = Storage
  { storageAddress :: Address
  , storageKV      :: StorageKV
  , storageChainId :: Maybe ChainId
  , storageKind    :: CodeKind
  } deriving (Eq, Show, Generic, ToSchema)

instance FromJSON Storage where
  parseJSON (Object o) = do
    addr <- o .: "address"
    chain <- o .:? "chain_id"
    codeKind <- o .:? "kind" .!= EVM
    kv <- case codeKind of
      EVM -> liftM2 EVMEntry (o .: "key") (o .: "value")
      SolidVM -> liftM2 SolidVMEntry (o .: "key") (o .: "value")
    return $ Storage addr kv chain codeKind
  parseJSON x = typeMismatch "Storage" x

instance ToJSON Storage where
  toJSON Storage{..} =
    let (t, k, v) =
          case storageKV of
              EVMEntry k' v' -> ("kind" .= EVM, "key" .= k', "value" .= v')
              SolidVMEntry k' v' -> ("kind" .= SolidVM, "key" .= k', "value" .= v')
        a = "address" .= storageAddress
        c_id = case storageChainId of
                  Nothing -> []
                  Just c_id' -> ["chain_id" .= c_id']
    in object $ a:t:k:v:c_id

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

stratoSchemaOptions :: SchemaOptions
stratoSchemaOptions = defaultSchemaOptions {Sw.fieldLabelModifier = camelCase . dropFPrefix}
