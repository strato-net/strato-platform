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

module Bloc.API.Transaction (
    PostBlocTransactionParallel,
    PostBlocTransactionBody,
    PostBlocTransactionUnsigned,
    PostBlocTransaction,
    PostBlocTransactionParallelExternal,
    PostBlocTransactionSimulate,
    PostBlocTransactionRequest(..),
    BlocTransactionPayload(..),
    BlocTransactionType(..),
    BlocSimulateResult(..),
    SimulatedEvent(..),
    FunctionPayload(..),
    ContractPayload(..),
    TransferPayload(..),
    transactionType
    ) where

import Bloc.API.SwaggerSchema
import Bloc.API.Users
import Bloc.API.Utils
import BlockApps.Solidity.ArgValue
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Gas
import Blockchain.Strato.Model.Nonce
import Blockchain.Strato.Model.Wei
import Control.Lens (mapped)
import Control.Lens.Operators hiding ((.=))
import Data.Aeson hiding (Success)
import Data.Aeson.Casing
import Data.Map (Map)
import qualified Data.Map as Map
import Data.Maybe
import Data.Source.Map
import Data.Text (Text)
import GHC.Generics
import qualified Generic.Random as GR
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

type PostBlocTransactionParallel =
  "transaction"
    :> "parallel"
    :> QueryParam "username" String
    :> QueryFlag "resolve"
    :> ReqBody '[JSON] PostBlocTransactionRequest
    :> Post '[JSON] [BlocTransactionResult]

type PostBlocTransactionParallelExternal = S.Header "Authorization" Text :> PostBlocTransactionParallel

type PostBlocTransaction =
  "transaction"
    :> QueryParam "username" String
    :> QueryFlag "resolve"
    :> ReqBody '[JSON] PostBlocTransactionRequest
    :> Post '[JSON] [BlocTransactionResult]


-- | PostBlocTransactionBody should return a list of signed transaction hashes,
-- using the caller's JWT, and their respective raw transaction bodies without
-- posting the transactions to the VM
--
-- This was made at the request of Stably for their API integration
type PostBlocTransactionBody =
  "transaction"
  -- | Transaction results
    :> "body" -- /transaction/body
    :> ReqBody '[JSON] PostBlocTransactionRequest -- SolidVM transaction
    :> Post '[JSON] [BlocTransactionBodyResult]

-- | PostBlocTransactionUnsigned should return a list of unsigned transaction hashes,
-- along with the unsigned transaction data, without
-- posting the transactions to the VM
--
-- This was made at the request of Stably for their API integration
type PostBlocTransactionUnsigned =
  "transaction"
  -- | Transaction results
    :> "unsigned" -- /transaction/unsigned
    -- | When supplied, a CONTRACT/FUNCTION tx is wrapped as a call to the user's
    -- on-chain User wallet contract (createContract/callContract), so it becomes a
    -- MessageTX that an external wallet (e.g. MetaMask) can sign via EIP-712.
    :> QueryParam "username" String
    :> ReqBody '[JSON] PostBlocTransactionRequest -- SolidVM transaction
    :> Post '[JSON] [BlocTransactionUnsignedResult]

-- | PostBlocTransactionSimulate dry-runs the same request body as
-- /transaction in the node's VM sandbox: identical marshaling (args,
-- User-wallet wrapping) but nothing is signed, nonced, or committed.
-- chainid is declared only to be rejected explicitly (main chain only).
type PostBlocTransactionSimulate =
  "transaction"
    :> "simulate" -- /transaction/simulate
    :> QueryParam "username" String
    :> QueryParam "chainid" Text
    :> QueryFlag "trace"
    :> ReqBody '[JSON] PostBlocTransactionRequest
    :> Post '[JSON] [BlocSimulateResult]

instance ToParam (QueryParam "chainid" Text) where
  toParam _ =
    DocQueryParam
      "chainid"
      []
      "Rejected by /transaction/simulate: simulation is main-chain only"
      Normal

instance ToParam (QueryFlag "trace") where
  toParam _ =
    DocQueryParam
      "trace"
      []
      "Include a call-frame execution trace (single-transaction bodies only)"
      Flag

-- | An event emitted during a simulated execution.
data SimulatedEvent = SimulatedEvent
  { simulatedeventAddress :: Text,
    simulatedeventName :: Text,
    simulatedeventArgs :: Map Text Text
  }
  deriving (Eq, Show, Generic)

instance ToJSON SimulatedEvent where
  toJSON = genericToJSON (aesonPrefix camelCase)

instance FromJSON SimulatedEvent where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance Arbitrary SimulatedEvent where
  arbitrary = GR.genericArbitrary GR.uniform

instance ToSample SimulatedEvent where toSamples _ = noSamples

instance ToSchema SimulatedEvent where
  declareNamedSchema proxy =
    genericDeclareNamedSchema blocSchemaOptions proxy
      & mapped . name ?~ "SimulatedEvent"
      & mapped . schema . description ?~ "An event emitted during a simulated execution"

-- | The outcome of one simulated transaction. `response` carries the raw
-- SolidVM return value (the same JSON form as TransactionResult.response);
-- `data` mirrors the posted-transaction result shape (Call/Upload).
data BlocSimulateResult = BlocSimulateResult
  { blocsimulateStatus :: BlocTransactionStatus,
    blocsimulateGasUsed :: Integer,
    blocsimulateResponse :: Maybe Value,
    blocsimulateData :: Maybe BlocTransactionData,
    blocsimulateEvents :: [SimulatedEvent],
    blocsimulateError :: Maybe Text,
    blocsimulateTrace :: Maybe Value,
    -- | For a `castVoteOnIssue` call, the independently-simulated effect the
    -- issue would have if the vote reached its threshold now: `target.func(args)`
    -- executed as the registry/wallet. When the effect is itself a
    -- `castVoteOnIssue` — a vote wrapped through nested multisigs — this chains
    -- recursively (depth-capped), one result per hop, ending at the ultimate
    -- action. Nothing for any other call.
    blocsimulateEffect :: Maybe BlocSimulateResult
  }
  deriving (Eq, Show, Generic)

instance ToJSON BlocSimulateResult where
  toJSON = genericToJSON (aesonPrefix camelCase)

instance FromJSON BlocSimulateResult where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance Arbitrary BlocSimulateResult where
  arbitrary =
    BlocSimulateResult
      <$> arbitrary
      <*> arbitrary
      <*> pure Nothing
      <*> pure Nothing
      <*> arbitrary
      <*> arbitrary
      <*> pure Nothing
      -- Non-recursive: keep the generated tree finite.
      <*> pure Nothing

instance ToSample BlocSimulateResult where toSamples _ = noSamples

instance ToSchema BlocSimulateResult where
  declareNamedSchema proxy =
    genericDeclareNamedSchema blocSchemaOptions proxy
      & mapped . name ?~ "BlocSimulateResult"
      & mapped . schema . description ?~ "Result of a simulated (dry-run) transaction"

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
              Nothing
              (Just $ Map.fromList [("purpose", "groceries")])
        ]
        (Just (TxParams (Just $ Gas 1000000) (Just $ Wei 1) (Just $ Nonce 0) Nothing))
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
                Nothing
                (Just $ Map.fromList [("purpose", "groceries")])
          ]
          (Just (TxParams (Just $ Gas 1000000) (Just $ Wei 1) (Just $ Nonce 0) Nothing))
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
    contractpayloadTxParams :: Maybe TxParams,
    contractpayloadMetadata :: Maybe (Map Text Text)
  }
  deriving (Eq, Show, Generic)

data TransferPayload = TransferPayload
  { transferpayloadToAddress :: Address,
    transferpayloadTxParams :: Maybe TxParams,
    transferpayloadMetadata :: Maybe (Map Text Text)
  }
  deriving (Eq, Show, Generic)

data FunctionPayload = FunctionPayload
  { functionpayloadContractAddress :: Address,
    functionpayloadMethod :: Text,
    functionpayloadArgs :: Map Text ArgValue,
    functionpayloadTxParams :: Maybe TxParams,
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
        "txParams" .= contractpayloadTxParams,
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
      <*> (o .:? "txParams")
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
              contractpayloadTxParams = Nothing,
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
            contractpayloadTxParams = Nothing,
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
            transferpayloadTxParams = Nothing,
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
            functionpayloadTxParams = Nothing,
            functionpayloadMetadata = Nothing
          }
