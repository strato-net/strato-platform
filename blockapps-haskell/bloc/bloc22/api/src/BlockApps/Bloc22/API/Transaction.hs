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
--import qualified Data.ByteString.Lazy               as ByteString.Lazy
import           Data.Map                           (Map)
import qualified Data.Map                           as Map
--import           Data.Proxy
import           Data.Text                          (Text)
--import qualified Data.Text.Encoding                 as Text
import           Generic.Random.Generic
import           GHC.Generics
import           Numeric.Natural
import           Servant.API                        as S
import           Servant.Docs
import           Test.QuickCheck                    hiding (Success,Failure)

import           BlockApps.Bloc22.API.SwaggerSchema
import           BlockApps.Bloc22.API.Users 
import           BlockApps.Bloc22.API.Utils
import           BlockApps.Ethereum
import           BlockApps.Solidity.ArgValue
--import           BlockApps.Solidity.SolidityValue
--import           BlockApps.Solidity.Xabi
import           BlockApps.Strato.Types

--------------------------------------------------------------------------------
---- Routes and Types
--------------------------------------------------------------------------------

data BlocTransactionType = TRANSFER | CONTRACT | FUNCTION deriving (Eq, Ord, Show, Generic)

instance Arbitrary BlocTransactionType where
  arbitrary = genericArbitrary uniform

instance FromJSON BlocTransactionType where
  parseJSON = genericParseJSON defaultOptions

instance ToJSON BlocTransactionType where
  toJSON = genericToJSON defaultOptions

instance ToSchema BlocTransactionType where
  declareNamedSchema proxy = genericDeclareNamedSchema blocSchemaOptions proxy
    & mapped.schema.description ?~ "Bloc Transaction Type"
    & mapped.schema.example ?~ toJSON CONTRACT

--------------------------------------------------------------------------------

type PostBlocTransaction = "transaction"
  :> S.Header "X-USER-UNIQUE-NAME" Text
  :> QueryParam "chainid" ChainId
  :> QueryFlag "resolve"
  :> ReqBody '[JSON] PostBlocTransactionRequest
  :> Post '[JSON] [BlocTransactionResult]

data PostBlocTransactionRequest = PostBlocTransactionRequest
  { postbloctransactionrequestAddress  :: Address
  , postbloctransactionrequestTxs      :: [(BlocTransactionType, BlocTransactionPayload)]
  , postbloctransactionrequestTxParams :: Maybe TxParams
  } deriving (Eq, Show, Generic)

--instance Arbitrary PostBlocTransactionRequest where 
  --arbitrary = genericArbitrary uniform

instance ToJSON PostBlocTransactionRequest where
  toJSON = genericToJSON (aesonPrefix camelCase)

instance FromJSON PostBlocTransactionRequest where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance ToSample PostBlocTransactionRequest where
  toSamples _ = singleSample $
    PostBlocTransactionRequest
      (Address 0xdeadbeef)
      [(TRANSFER,
        BlocTransfer $ TransferPayload
          (Address 0x12345678)
          (Strung 600)
       )]
      (Just (TxParams (Just $ Gas 1) (Just $ Wei 1) (Just $ Nonce 0)))

instance ToSchema PostBlocTransactionRequest where
  declareNamedSchema proxy = genericDeclareNamedSchema blocSchemaOptions proxy
    & mapped.name ?~ "PostBlocTransactionRequest"
    & mapped.schema.description ?~ "Post Bloc Transaction Request"
    & mapped.schema.example ?~ toJSON ex
    where
      ex :: PostBlocTransactionRequest
      ex = PostBlocTransactionRequest
                 (Address 0xdeadbeef)
                 [(TRANSFER,
                   BlocTransfer $ TransferPayload
                     (Address 0x12345678)
                     (Strung 600)
                 )]
                 (Just (TxParams (Just $ Gas 1) (Just $ Wei 1) (Just $ Nonce 0)))

data BlocTransactionPayload = BlocContract ContractPayload
                            | BlocTransfer TransferPayload
                            | BlocFunction FunctionPayload
                            deriving (Eq, Show, Generic)

data ContractPayload = ContractPayload
  { contractpayloadSrc      :: Text
  , contractpayloadContract :: Maybe Text
  , contractpayloadArgs     :: Maybe (Map Text ArgValue)
  , contractpayloadValue    :: Maybe (Strung Natural)
  } deriving (Eq, Show, Generic)

data TransferPayload = TransferPayload
  { transferpayloadTo    :: Address
  , transferpayloadValue :: Strung Natural
  } deriving (Eq, Show, Generic)

data FunctionPayload = FunctionPayload
  { functionpayloadContractName    :: ContractName
  , functionpayloadContractAddress :: Address
  , functionpayloadMethod          :: Text
  , functionpayloadArgs            :: Map Text ArgValue
  , functionpayloadValue           :: Maybe (Strung Natural)
  } deriving (Eq, Show, Generic)

instance ToJSON BlocTransactionPayload where
instance FromJSON BlocTransactionPayload where

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
        }

instance ToSchema TransferPayload where
  declareNamedSchema proxy = genericDeclareNamedSchema blocSchemaOptions proxy
    & mapped.name ?~ "TransferPayload"
    & mapped.schema.description ?~ "Transfer Payload"
    & mapped.schema.example ?~ toJSON ex
    where
      ex :: TransferPayload
      ex = TransferPayload
        { transferpayloadTo    = Address (0xdeadbeef)
        , transferpayloadValue = Strung 1000000
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
        }
