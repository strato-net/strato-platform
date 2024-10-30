{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DuplicateRecordFields #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedLists #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Bloc.API.Transaction where

import Bloc.API.SwaggerSchema
import Bloc.API.TypeWrappers
import Bloc.API.Users
import Bloc.API.Utils
import BlockApps.Solidity.ArgValue
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainId
import Blockchain.Strato.Model.Code
import Blockchain.Strato.Model.ExtendedWord (Word256)
import Blockchain.Strato.Model.Gas
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Nonce
import Blockchain.Strato.Model.Wei
import Control.Applicative ((<|>))
import Control.Lens (mapped)
import Control.Lens.Operators hiding ((.=))
import Data.Aeson hiding (Success)
import Data.Aeson.Casing
import qualified Data.ByteString as B
import Data.Map (Map)
import qualified Data.Map as Map
import Data.Maybe
import Data.Source.Map
import Data.Text (Text)
import Data.Word
import GHC.Generics
import qualified Generic.Random as GR
import Numeric.Natural
import Servant.API as S
import Servant.Docs
import Test.QuickCheck hiding (Success)

--------------------------------------------------------------------------------
---- Routes and Types
--------------------------------------------------------------------------------

data BlocTransactionType = TRANSFER | CONTRACT | FUNCTION
  deriving (Eq, Ord, Show, Generic)

instance ToJSON BlocTransactionType

instance FromJSON BlocTransactionType

transactionType :: BlocTransactionPayload -> BlocTransactionType
transactionType (BlocTransfer _) = TRANSFER
transactionType (BlocContract _) = CONTRACT
transactionType (BlocFunction _) = FUNCTION

instance ToParam (QueryFlag "queue") where
  toParam _ =
    DocQueryParam "queue" ["true", "false", ""] "flag for queueing a transaction request" Flag

type PostBlocTransactionParallelCommon tokenHeaderName = 
  "transaction"
    :> "parallel"
    :> S.Header tokenHeaderName Text
    :> QueryParam "chainid" ChainId
    :> QueryParam "use_wallet" Bool -- Using QueryParam here to distinguish between Nothing and Just False
    :> QueryFlag "resolve"
    :> QueryFlag "queue"
    :> ReqBody '[JSON] PostBlocTransactionRequest
    :> Post '[JSON] [BlocChainOrTransactionResult]

type PostBlocTransactionParallel = PostBlocTransactionParallelCommon "X-USER-ACCESS-TOKEN"
type PostBlocTransactionParallelExternal = PostBlocTransactionParallelCommon "Authorization"

type PostBlocTransaction =
  "transaction"
    :> S.Header "X-USER-ACCESS-TOKEN" Text
    :> QueryParam "chainid" ChainId
    :> QueryParam "use_wallet" Bool -- Using QueryParam here to distinguish between Nothing and Just False
    :> QueryFlag "resolve"
    :> ReqBody '[JSON] PostBlocTransactionRequest
    :> Post '[JSON] [BlocChainOrTransactionResult]


-- | PostBlocTransactionBody should return a list of signed transaction hashes,
-- using the caller's JWT, and their respective raw transaction bodies without
-- posting the transactions to the VM
--
-- This was made at the request of Stably for their API integration
type PostBlocTransactionBody =
  -- | Transaction results
  "transaction"
    :> "body" -- /transaction/body
    :> S.Header "X-USER-ACCESS-TOKEN" Text -- jwt
    :> QueryParam "chainid" ChainId -- shard ID (optional)
    :> ReqBody '[JSON] PostBlocTransactionRequest -- SolidVM transaction
    :> Post '[JSON] [BlocTransactionBodyResult]

-- | PostBlocTransactionUnsigned should return a list of unsigned transaction hashes,
-- along with the unsigned transaction data, without
-- posting the transactions to the VM
--
-- This was made at the request of Stably for their API integration
type PostBlocTransactionUnsigned =
  -- | Transaction results
  "transaction"
    :> "unsigned" -- /transaction/unsigned
    :> S.Header "X-USER-ACCESS-TOKEN" Text -- jwt
    :> QueryParam "chainid" ChainId -- shard ID (optional)
    :> ReqBody '[JSON] PostBlocTransactionRequest -- SolidVM transaction
    :> Post '[JSON] [BlocTransactionUnsignedResult]

data PostBlocTransactionRawRequest = PostBlocTransactionRawRequest
  { postbloctransactionrawrequestAddress :: Address,
    postbloctransactionrawrequestNonce :: Nonce,
    postbloctransactionrawrequestGasPrice :: Wei,
    postbloctransactionrawrequestGasLimit :: Gas,
    postbloctransactionrawrequestTo :: Maybe Address,
    postbloctransactionrawrequestValue :: Wei,
    postbloctransactionrawrequestInitOrData :: Code,
    postbloctransactionrawrequestChainId :: Maybe ChainId,
    postbloctransactionrawrequestR :: Word256,
    postbloctransactionrawrequestS :: Word256,
    postbloctransactionrawrequestV :: Maybe Word8, -- we can infer from Address if necessary
    postbloctransactionrawrequestMetadata :: Maybe (Map Text Text)
  }
  deriving (Eq, Show, Generic)

instance Arbitrary PostBlocTransactionRawRequest where
  arbitrary = GR.genericArbitrary GR.uniform

instance ToJSON PostBlocTransactionRawRequest where
  toJSON = genericToJSON (aesonPrefix camelCase)

instance FromJSON PostBlocTransactionRawRequest where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance ToSample PostBlocTransactionRawRequest where
  toSamples _ =
    singleSample $
      PostBlocTransactionRawRequest
        (Address 0x12345678)
        (Nonce 42)
        (Wei 1)
        (Gas 2190000)
        Nothing
        (Wei 4)
        (Code (B.singleton 7))
        Nothing
        (21 :: Word256)
        (42 :: Word256)
        Nothing
        Nothing

instance ToSchema PostBlocTransactionRawRequest where
  declareNamedSchema proxy =
    genericDeclareNamedSchema blocSchemaOptions proxy
      & mapped . name ?~ "PostBlocTransactionRawRequest"
      & mapped . schema . description ?~ "Post Bloc Transaction Raw Request"
      & mapped . schema . example ?~ toJSON ex
    where
      ex :: PostBlocTransactionRawRequest
      ex =
        PostBlocTransactionRawRequest
          (Address 0x12345678)
          (Nonce 42)
          (Wei 1)
          (Gas 2190000)
          Nothing
          (Wei 4)
          (Code (B.singleton 7))
          Nothing
          (21 :: Word256)
          (42 :: Word256)
          Nothing
          Nothing

data PostBlocTransactionRequest = PostBlocTransactionRequest
  { postbloctransactionrequestAddress :: Maybe Address,
    postbloctransactionrequestTxs :: [BlocTransactionPayload],
    postbloctransactionrequestTxParams :: Maybe TxParams,
    postbloctransactionrequestSrcs :: Maybe (Map Text SourceMap)
  }
  deriving (Eq, Show, Generic)

instance Arbitrary PostBlocTransactionRequest where
  arbitrary = GR.genericArbitrary GR.uniform

instance ToJSON PostBlocTransactionRequest where
  toJSON = genericToJSON (aesonPrefix camelCase)

instance FromJSON PostBlocTransactionRequest where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance ToSample PostBlocTransactionRequest where
  toSamples _ =
    singleSample $
      PostBlocTransactionRequest
        (Just $ Address 0xdeadbeef)
        [ BlocTransfer $
            TransferPayload
              (Address 0x12345678)
              (Strung 600)
              Nothing
              Nothing
              (Just $ Map.fromList [("purpose", "groceries")])
        ]
        (Just (TxParams (Just $ Gas 1000000) (Just $ Wei 1) (Just $ Nonce 0)))
        Nothing

instance ToSchema PostBlocTransactionRequest where
  declareNamedSchema proxy =
    genericDeclareNamedSchema blocSchemaOptions proxy
      & mapped . name ?~ "PostBlocTransactionRequest"
      & mapped . schema . description ?~ "Post Bloc Transaction Request"
      & mapped . schema . example ?~ toJSON ex
    where
      ex :: PostBlocTransactionRequest
      ex =
        PostBlocTransactionRequest
          (Just $ Address 0xdeadbeef)
          [ BlocTransfer $
              TransferPayload
                (Address 0x12345678)
                (Strung 600)
                Nothing
                Nothing
                (Just $ Map.fromList [("purpose", "groceries")])
          ]
          (Just (TxParams (Just $ Gas 1000000) (Just $ Wei 1) (Just $ Nonce 0)))
          Nothing

data BlocTransactionPayload
  = BlocTransfer TransferPayload
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
  parseJSON o = fail $ "fromJSON BlocTransactionPayload: Expected Object, but got " ++ show o

data ContractPayload = ContractPayload
  { contractpayloadSrc :: SourceMap,
    contractpayloadContract :: Maybe Text,
    contractpayloadArgs :: Maybe (Map Text ArgValue),
    contractpayloadValue :: Maybe (Strung Natural),
    contractpayloadTxParams :: Maybe TxParams,
    contractpayloadChainid :: Maybe ChainId,
    contractpayloadCodePtr :: Maybe Address,
    contractpayloadMetadata :: Maybe (Map Text Text)
  }
  deriving (Eq, Show, Generic)

data TransferPayload = TransferPayload
  { transferpayloadToAddress :: Address,
    transferpayloadValue :: Strung Natural,
    transferpayloadTxParams :: Maybe TxParams,
    transferpayloadChainid :: Maybe ChainId,
    transferpayloadMetadata :: Maybe (Map Text Text)
  }
  deriving (Eq, Show, Generic)

data FunctionPayload = FunctionPayload
  { functionpayloadContractAddress :: Address,
    functionpayloadMethod :: Text,
    functionpayloadArgs :: Map Text ArgValue,
    functionpayloadValue :: Maybe (Strung Natural),
    functionpayloadTxParams :: Maybe TxParams,
    functionpayloadChainid :: Maybe ChainId,
    functionpayloadMetadata :: Maybe (Map Text Text)
  }
  deriving (Eq, Show, Generic)

instance Arbitrary ContractPayload where
  arbitrary = GR.genericArbitrary GR.uniform

instance Arbitrary TransferPayload where
  arbitrary = GR.genericArbitrary GR.uniform

instance Arbitrary FunctionPayload where
  arbitrary = GR.genericArbitrary GR.uniform

instance ToJSON ContractPayload where
  toJSON ContractPayload {..} =
    object
      [ "contract" .= contractpayloadContract,
        "src" .= contractpayloadSrc,
        "args" .= contractpayloadArgs,
        "value" .= contractpayloadValue,
        "txParams" .= contractpayloadTxParams,
        "chainid" .= contractpayloadChainid,
        "codePtr" .= contractpayloadCodePtr,
        "metadata" .= contractpayloadMetadata
      ]

instance ToJSON TransferPayload where
  toJSON = genericToJSON (aesonPrefix camelCase)

instance ToJSON FunctionPayload where
  toJSON = genericToJSON (aesonPrefix camelCase)

instance FromJSON ContractPayload where
  parseJSON (Object o) =
    ContractPayload
      <$> (fromMaybe mempty <$> o .:? "src")
      <*> (o .:? "contract")
      <*> (o .:? "args")
      <*> (o .:? "value")
      <*> (o .:? "txParams")
      <*> (o .:? "chainid")
      <*> (o .:? "codePtr")
      <*> (o .:? "metadata")
  parseJSON o = fail $ "parseJSON ContractPayload: Expected Object, got " ++ show o

instance FromJSON TransferPayload where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance FromJSON FunctionPayload where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance ToSchema BlocTransactionPayload where
  declareNamedSchema proxy =
    genericDeclareNamedSchema blocSchemaOptions proxy
      & mapped . name ?~ "BlocTransactionPayload"
      & mapped . schema . description ?~ "Bloc Transaction Payload"
      & mapped . schema . example ?~ toJSON ex
    where
      ex :: BlocTransactionPayload
      ex =
        BlocContract $
          ContractPayload
            { contractpayloadSrc = namedSource "SimpleStorage.sol" "contract SimpleStorage { uint x; function SimpleStorage(uint _x) { x = _x; } function set(uint _x) { x = _x; } }",
              contractpayloadContract = Nothing,
              contractpayloadArgs = Just $ Map.fromList [("_x", ArgInt 1)],
              contractpayloadValue = Nothing,
              contractpayloadTxParams = Nothing,
              contractpayloadChainid = Nothing,
              contractpayloadCodePtr = Nothing,
              contractpayloadMetadata = Nothing
            }

instance ToSchema ContractPayload where
  declareNamedSchema proxy =
    genericDeclareNamedSchema blocSchemaOptions proxy
      & mapped . name ?~ "ContractPayload"
      & mapped . schema . description ?~ "Contract Payload"
      & mapped . schema . example ?~ toJSON ex
    where
      ex :: ContractPayload
      ex =
        ContractPayload
          { contractpayloadSrc = namedSource "SimpleStorage.sol" "contract SimpleStorage { uint x; function SimpleStorage(uint _x) { x = _x; } function set(uint _x) { x = _x; } }",
            contractpayloadContract = Nothing,
            contractpayloadArgs = Just $ Map.fromList [("_x", ArgInt 1)],
            contractpayloadValue = Nothing,
            contractpayloadTxParams = Nothing,
            contractpayloadChainid = Nothing,
            contractpayloadCodePtr = Nothing,
            contractpayloadMetadata = Nothing
          }

instance ToSchema TransferPayload where
  declareNamedSchema proxy =
    genericDeclareNamedSchema blocSchemaOptions proxy
      & mapped . name ?~ "TransferPayload"
      & mapped . schema . description ?~ "Transfer Payload"
      & mapped . schema . example ?~ toJSON ex
    where
      ex :: TransferPayload
      ex =
        TransferPayload
          { transferpayloadToAddress = Address (0xdeadbeef),
            transferpayloadValue = Strung 1000000,
            transferpayloadTxParams = Nothing,
            transferpayloadChainid = Nothing,
            transferpayloadMetadata = Nothing
          }

instance ToSchema FunctionPayload where
  declareNamedSchema proxy =
    genericDeclareNamedSchema blocSchemaOptions proxy
      & mapped . name ?~ "FunctionPayload"
      & mapped . schema . description ?~ "Function Payload"
      & mapped . schema . example ?~ toJSON ex
    where
      ex :: FunctionPayload
      ex =
        FunctionPayload
          { functionpayloadContractAddress = Address (0xdeadbeef),
            functionpayloadMethod = "set",
            functionpayloadArgs = Map.fromList [("_x", ArgInt 5)],
            functionpayloadValue = Nothing,
            functionpayloadTxParams = Nothing,
            functionpayloadChainid = Nothing,
            functionpayloadMetadata = Nothing
          }

data BlocChainOrTransactionResult
  = BlocChainResult ChainId
  | BlocTxResult BlocTransactionResult
  deriving (Eq, Show, Generic)

instance ToJSON BlocChainOrTransactionResult where
  toJSON (BlocChainResult cid) = toJSON cid
  toJSON (BlocTxResult btr) = toJSON btr

instance FromJSON BlocChainOrTransactionResult where
  parseJSON o =
    (BlocTxResult <$> parseJSON o)
      <|> (BlocChainResult <$> parseJSON o)

instance Arbitrary BlocChainOrTransactionResult where
  arbitrary = GR.genericArbitrary GR.uniform

instance ToSample BlocChainOrTransactionResult where
  toSamples _ =
    singleSample . BlocTxResult $
      BlocTransactionResult
        { blocTransactionStatus = Success,
          blocTransactionHash = hash "foo",
          blocTransactionTxResult = Nothing,
          blocTransactionData = Nothing
        }

instance ToSchema BlocChainOrTransactionResult where
  declareNamedSchema proxy =
    genericDeclareNamedSchema blocSchemaOptions proxy
      & mapped . schema . description ?~ "Bloc Chain or Transaction Result"
      & mapped . schema . example ?~ toJSON ex
    where
      ex :: BlocChainOrTransactionResult
      ex =
        BlocTxResult $
          BlocTransactionResult
            { blocTransactionStatus = Success,
              blocTransactionHash = hash "foo",
              blocTransactionTxResult = Nothing,
              blocTransactionData = Nothing
            }

instance ToParam (QueryFlag "hash") where
  toParam _ =
    DocQueryParam "hash" ["true", "false", ""] "flag for generating a tx hash without posting it to the network" Flag
