{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE DataKinds                  #-}
{-# LANGUAGE DeriveGeneric              #-}
{-# LANGUAGE DuplicateRecordFields      #-}
{-# LANGUAGE FlexibleInstances          #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses      #-}
{-# LANGUAGE OverloadedLists            #-}
{-# LANGUAGE OverloadedStrings          #-}
{-# LANGUAGE ScopedTypeVariables        #-}
{-# LANGUAGE TypeOperators              #-}

module BlockApps.Bloc22.API.Transaction where

import           Control.Lens                       (mapped)
import           Control.Lens.Operators             hiding ((.=))
import           Data.Aeson                         hiding (Success)
import           Data.Aeson.Casing
import           Data.Map                           (Map)
import qualified Data.Map                           as Map
import           Data.Text                          (Text)
import qualified Generic.Random                     as GR
import           GHC.Generics
import           Numeric.Natural
import           Servant.API                        as S
import           Servant.Docs
import           Test.QuickCheck

import           BlockApps.Bloc22.API.SwaggerSchema
import           BlockApps.Bloc22.API.Users
import           BlockApps.Bloc22.API.Utils
import           BlockApps.Ethereum
import           BlockApps.Solidity.ArgValue
import           BlockApps.Strato.Types

--------------------------------------------------------------------------------
---- Routes and Types
--------------------------------------------------------------------------------

data BlocTransactionType = TRANSFER | CONTRACT | FUNCTION deriving (Eq, Ord, Show, Generic)

instance ToJSON BlocTransactionType where
instance FromJSON BlocTransactionType where

transactionType :: BlocTransactionPayload -> BlocTransactionType
transactionType (BlocTransfer _) = TRANSFER
transactionType (BlocContract _) = CONTRACT
transactionType (BlocFunction _) = FUNCTION

type PostBlocTransaction = "transaction"
  :> S.Header "X-USER-UNIQUE-NAME" Text
  :> QueryParam "chainid" ChainId
  :> QueryFlag "resolve"
  :> ReqBody '[JSON] PostBlocTransactionRequest
  :> Post '[JSON] [BlocTransactionResult]

data PostBlocTransactionRequest = PostBlocTransactionRequest
  { postbloctransactionrequestAddress  :: Maybe Address
  , postbloctransactionrequestTxs      :: [BlocTransactionPayload]
  , postbloctransactionrequestTxParams :: Maybe TxParams
  } deriving (Eq, Show, Generic)

instance Arbitrary PostBlocTransactionRequest where
  arbitrary = GR.genericArbitrary GR.uniform

instance ToJSON PostBlocTransactionRequest where
  toJSON = genericToJSON (aesonPrefix camelCase)

instance FromJSON PostBlocTransactionRequest where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance ToSample PostBlocTransactionRequest where
  toSamples _ = singleSample $
    PostBlocTransactionRequest
      (Just $ Address 0xdeadbeef)
      [BlocTransfer $ TransferPayload
        (Address 0x12345678)
        (Strung 600)
        (Just $ Map.fromList [("purpose","groceries")])
      ]
      (Just (TxParams (Just $ Gas 1000000) (Just $ Wei 1) (Just $ Nonce 0)))

instance ToSchema PostBlocTransactionRequest where
  declareNamedSchema proxy = genericDeclareNamedSchema blocSchemaOptions proxy
    & mapped.name ?~ "PostBlocTransactionRequest"
    & mapped.schema.description ?~ "Post Bloc Transaction Request"
    & mapped.schema.example ?~ toJSON ex
    where
      ex :: PostBlocTransactionRequest
      ex = PostBlocTransactionRequest
                 (Just $ Address 0xdeadbeef)
                 [BlocTransfer $ TransferPayload
                   (Address 0x12345678)
                   (Strung 600)
                   (Just $ Map.fromList [("purpose","groceries")])
                 ]
                 (Just (TxParams (Just $ Gas 1000000) (Just $ Wei 1) (Just $ Nonce 0)))

data BlocTransactionPayload = BlocTransfer TransferPayload
                            | BlocContract ContractPayload
                            | BlocFunction FunctionPayload
                            deriving (Eq, Show, Generic)

instance Arbitrary BlocTransactionPayload where
  arbitrary = GR.genericArbitrary GR.uniform


instance ToJSON BlocTransactionPayload where
  toJSON (BlocTransfer t) = object ["type" .= TRANSFER, "payload" .= t]
  toJSON (BlocContract c) = object ["type" .= CONTRACT, "payload" .= c]
  toJSON (BlocFunction f) = object ["type" .= FUNCTION, "payload" .= f]

instance FromJSON BlocTransactionPayload where
  parseJSON (Object o) = do
    ttype <- (o .: "type")
    case ttype of
      TRANSFER -> BlocTransfer <$> (o .: "payload")
      CONTRACT -> BlocContract <$> (o .: "payload")
      FUNCTION -> BlocFunction <$> (o .: "payload")
  parseJSON o = error $ "fromJSON BlocTransactionPayload: Expected Object, but got " ++ show o

data ContractPayload = ContractPayload
  { contractpayloadSrc      :: Text
  , contractpayloadContract :: Maybe Text
  , contractpayloadArgs     :: Maybe (Map Text ArgValue)
  , contractpayloadValue    :: Maybe (Strung Natural)
  , contractpayloadMetadata :: Maybe (Map Text Text)
  } deriving (Eq, Show, Generic)

data TransferPayload = TransferPayload
  { transferpayloadToAddress :: Address
  , transferpayloadValue     :: Strung Natural
  , transferpayloadMetadata  :: Maybe (Map Text Text)
  } deriving (Eq, Show, Generic)

data FunctionPayload = FunctionPayload
  { functionpayloadContractName    :: ContractName
  , functionpayloadContractAddress :: Address
  , functionpayloadMethod          :: Text
  , functionpayloadArgs            :: Map Text ArgValue
  , functionpayloadValue           :: Maybe (Strung Natural)
  , functionpayloadMetadata        :: Maybe (Map Text Text)
  } deriving (Eq, Show, Generic)

instance Arbitrary ContractPayload where
  arbitrary = GR.genericArbitrary GR.uniform
instance Arbitrary TransferPayload where
  arbitrary = GR.genericArbitrary GR.uniform
instance Arbitrary FunctionPayload where
  arbitrary = GR.genericArbitrary GR.uniform

instance ToJSON ContractPayload where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance ToJSON TransferPayload where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance ToJSON FunctionPayload where
  toJSON = genericToJSON (aesonPrefix camelCase)

instance FromJSON ContractPayload where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance FromJSON TransferPayload where
  parseJSON = genericParseJSON (aesonPrefix camelCase)
instance FromJSON FunctionPayload where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance ToSchema BlocTransactionPayload where
  declareNamedSchema proxy = genericDeclareNamedSchema blocSchemaOptions proxy
    & mapped.name ?~ "BlocTransactionPayload"
    & mapped.schema.description ?~ "Bloc Transaction Payload"
    & mapped.schema.example ?~ toJSON ex
    where
      ex :: BlocTransactionPayload
      ex = BlocContract $ ContractPayload
        { contractpayloadSrc      = "contract SimpleStorage { uint x; function SimpleStorage(uint _x) { x = _x; } function set(uint _x) { x = _x; } }"
        , contractpayloadContract = Nothing
        , contractpayloadArgs     = Just $ Map.fromList [("_x", ArgInt 1)]
        , contractpayloadValue    = Nothing
        , contractpayloadMetadata = Nothing
        }

instance ToSchema ContractPayload where
  declareNamedSchema proxy = genericDeclareNamedSchema blocSchemaOptions proxy
    & mapped.name ?~ "ContractPayload"
    & mapped.schema.description ?~ "Contract Payload"
    & mapped.schema.example ?~ toJSON ex
    where
      ex :: ContractPayload
      ex = ContractPayload
        { contractpayloadSrc      = "contract SimpleStorage { uint x; function SimpleStorage(uint _x) { x = _x; } function set(uint _x) { x = _x; } }"
        , contractpayloadContract = Nothing
        , contractpayloadArgs     = Just $ Map.fromList [("_x", ArgInt 1)]
        , contractpayloadValue    = Nothing
        , contractpayloadMetadata = Nothing
        }

instance ToSchema TransferPayload where
  declareNamedSchema proxy = genericDeclareNamedSchema blocSchemaOptions proxy
    & mapped.name ?~ "TransferPayload"
    & mapped.schema.description ?~ "Transfer Payload"
    & mapped.schema.example ?~ toJSON ex
    where
      ex :: TransferPayload
      ex = TransferPayload
        { transferpayloadToAddress = Address (0xdeadbeef)
        , transferpayloadValue = Strung 1000000
        , transferpayloadMetadata = Nothing
        }

instance ToSchema FunctionPayload where
  declareNamedSchema proxy = genericDeclareNamedSchema blocSchemaOptions proxy
    & mapped.name ?~ "FunctionPayload"
    & mapped.schema.description ?~ "Function Payload"
    & mapped.schema.example ?~ toJSON ex
    where
      ex :: FunctionPayload
      ex = FunctionPayload
        { functionpayloadContractName    = ContractName "SimpleStorage"
        , functionpayloadContractAddress = Address (0xdeadbeef)
        , functionpayloadMethod          = "set"
        , functionpayloadArgs            = Map.fromList [("_x", ArgInt 5)]
        , functionpayloadValue           = Nothing
        , functionpayloadMetadata = Nothing
        }
