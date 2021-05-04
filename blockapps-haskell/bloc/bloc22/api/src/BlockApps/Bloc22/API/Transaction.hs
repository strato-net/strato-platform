{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE DataKinds                  #-}
{-# LANGUAGE DeriveGeneric              #-}
{-# LANGUAGE DuplicateRecordFields      #-}
{-# LANGUAGE FlexibleInstances          #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses      #-}
{-# LANGUAGE OverloadedLists            #-}
{-# LANGUAGE OverloadedStrings          #-}
{-# LANGUAGE RecordWildCards            #-}
{-# LANGUAGE ScopedTypeVariables        #-}
{-# LANGUAGE TypeOperators              #-}

module BlockApps.Bloc22.API.Transaction where

import           Control.Applicative                ((<|>))
import           Control.Lens                       (mapped)
import           Control.Lens.Operators             hiding ((.=))
import           Data.Aeson                         hiding (Success)
import           Data.Aeson.Casing
import           Data.Map                           (Map)
import qualified Data.Map                           as Map
import           Data.Maybe
import           Data.Text                          (Text)
import qualified Generic.Random                     as GR
import           GHC.Generics
import           Numeric.Natural
import           Servant.API                        as S
import           Servant.Docs
import           Test.QuickCheck                    hiding (Success)

import           BlockApps.Bloc22.API.Chain
import           BlockApps.Bloc22.API.SwaggerSchema
import           BlockApps.Bloc22.API.Users
import           BlockApps.Bloc22.API.Utils
import           BlockApps.Solidity.ArgValue
import           BlockApps.Strato.Types

import           Blockchain.Strato.Model.CodePtr
import           Blockchain.Strato.Model.Gas
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.Strato.Model.Nonce
import           Blockchain.Strato.Model.SourceMap
import           Blockchain.Strato.Model.Wei

--------------------------------------------------------------------------------
---- Routes and Types
--------------------------------------------------------------------------------

data BlocTransactionType = TRANSFER | CONTRACT | FUNCTION | GENESIS
  deriving (Eq, Ord, Show, Generic)

instance ToJSON BlocTransactionType where
instance FromJSON BlocTransactionType where

transactionType :: BlocTransactionPayload -> BlocTransactionType
transactionType (BlocTransfer _) = TRANSFER
transactionType (BlocContract _) = CONTRACT
transactionType (BlocFunction _) = FUNCTION
transactionType (BlocGenesis _)  = GENESIS

instance ToParam (QueryFlag "queue") where
  toParam _ =
    DocQueryParam "queue" ["true","false",""] "flag for queueing a transaction request" Flag

type PostBlocTransactionParallel = "transaction"
  :> "parallel"
  :> S.Header "X-USER-UNIQUE-NAME" Text
  :> QueryParam "chainid" ChainId
  :> QueryFlag "resolve"
  :> QueryFlag "queue"
  :> ReqBody '[JSON] PostBlocTransactionRequest
  :> Post '[JSON] [BlocChainOrTransactionResult]

type PostBlocTransaction = "transaction"
  :> S.Header "X-USER-UNIQUE-NAME" Text
  :> QueryParam "chainid" ChainId
  :> QueryFlag "resolve"
  :> ReqBody '[JSON] PostBlocTransactionRequest
  :> Post '[JSON] [BlocChainOrTransactionResult]

data PostBlocTransactionRequest = PostBlocTransactionRequest
  { postbloctransactionrequestAddress  :: Maybe Address
  , postbloctransactionrequestTxs      :: [BlocTransactionPayload]
  , postbloctransactionrequestTxParams :: Maybe TxParams
  , postbloctransactionrequestSrcs     :: Maybe (Map Text SourceMap) 
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
        Nothing
        Nothing
        (Just $ Map.fromList [("purpose","groceries")])
      ]
      (Just (TxParams (Just $ Gas 1000000) (Just $ Wei 1) (Just $ Nonce 0)))
      Nothing

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
                   Nothing
                   Nothing
                   (Just $ Map.fromList [("purpose","groceries")])
                 ]
                 (Just (TxParams (Just $ Gas 1000000) (Just $ Wei 1) (Just $ Nonce 0)))
                 Nothing

data BlocTransactionPayload = BlocTransfer TransferPayload
                            | BlocContract ContractPayload
                            | BlocFunction FunctionPayload
                            | BlocGenesis  ChainInput
                            deriving (Eq, Show, Generic)

instance Arbitrary BlocTransactionPayload where
  arbitrary = GR.genericArbitrary GR.uniform


instance ToJSON BlocTransactionPayload where
  toJSON (BlocTransfer t) = object ["type" .= TRANSFER, "payload" .= t]
  toJSON (BlocContract c) = object ["type" .= CONTRACT, "payload" .= c]
  toJSON (BlocFunction f) = object ["type" .= FUNCTION, "payload" .= f]
  toJSON (BlocGenesis  g) = object ["type" .= GENESIS,  "payload" .= g]

instance FromJSON BlocTransactionPayload where
  parseJSON (Object o) = do
    ttype <- (o .: "type")
    case ttype of
      TRANSFER -> BlocTransfer <$> (o .: "payload")
      CONTRACT -> BlocContract <$> (o .: "payload")
      FUNCTION -> BlocFunction <$> (o .: "payload")
      GENESIS  -> BlocGenesis  <$> (o .: "payload")
  parseJSON o = error $ "fromJSON BlocTransactionPayload: Expected Object, but got " ++ show o

data ContractPayload = ContractPayload
  { contractpayloadSrc      :: SourceMap
  , contractpayloadCodePtr  :: Maybe CodePtr
  , contractpayloadContract :: Maybe Text
  , contractpayloadArgs     :: Maybe (Map Text ArgValue)
  , contractpayloadValue    :: Maybe (Strung Natural)
  , contractpayloadTxParams :: Maybe TxParams
  , contractpayloadChainid  :: Maybe ChainId
  , contractpayloadMetadata :: Maybe (Map Text Text)
  } deriving (Eq, Show, Generic)

data TransferPayload = TransferPayload
  { transferpayloadToAddress :: Address
  , transferpayloadValue     :: Strung Natural
  , transferpayloadTxParams  :: Maybe TxParams
  , transferpayloadChainid   :: Maybe ChainId
  , transferpayloadMetadata  :: Maybe (Map Text Text)
  } deriving (Eq, Show, Generic)

data FunctionPayload = FunctionPayload
  { functionpayloadContractName    :: ContractName
  , functionpayloadContractAddress :: Address
  , functionpayloadMethod          :: Text
  , functionpayloadArgs            :: Map Text ArgValue
  , functionpayloadValue           :: Maybe (Strung Natural)
  , functionpayloadTxParams        :: Maybe TxParams
  , functionpayloadChainid         :: Maybe ChainId
  , functionpayloadMetadata        :: Maybe (Map Text Text)
  } deriving (Eq, Show, Generic)

instance Arbitrary ContractPayload where
  arbitrary = GR.genericArbitrary GR.uniform
instance Arbitrary TransferPayload where
  arbitrary = GR.genericArbitrary GR.uniform
instance Arbitrary FunctionPayload where
  arbitrary = GR.genericArbitrary GR.uniform

instance ToJSON ContractPayload where
  toJSON ContractPayload{..} = object
    [ "contract" .= contractpayloadContract
    , "codePtr" .= contractpayloadCodePtr
    , "src" .= contractpayloadSrc
    , "args" .= contractpayloadArgs
    , "value" .= contractpayloadValue
    , "txParams" .= contractpayloadTxParams
    , "chainid" .= contractpayloadChainid
    , "metadata" .= contractpayloadMetadata
    ]
instance ToJSON TransferPayload where
  toJSON = genericToJSON (aesonPrefix camelCase)
instance ToJSON FunctionPayload where
  toJSON = genericToJSON (aesonPrefix camelCase)

instance FromJSON ContractPayload where
  parseJSON (Object o) = ContractPayload
                     <$> (fromMaybe mempty <$> o .:? "src")
                     <*> (o .:? "codePtr")
                     <*> (o .:? "contract")
                     <*> (o .:? "args")
                     <*> (o .:? "value")
                     <*> (o .:? "txParams")
                     <*> (o .:? "chainid")
                     <*> (o .:? "metadata")
  parseJSON o = fail $ "parseJSON ContractPayload: Expected Object, got " ++ show o
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
        { contractpayloadSrc      = namedSource "SimpleStorage.sol" "contract SimpleStorage { uint x; function SimpleStorage(uint _x) { x = _x; } function set(uint _x) { x = _x; } }"
        , contractpayloadCodePtr  = Nothing
        , contractpayloadContract = Nothing
        , contractpayloadArgs     = Just $ Map.fromList [("_x", ArgInt 1)]
        , contractpayloadValue    = Nothing
        , contractpayloadTxParams = Nothing
        , contractpayloadChainid  = Nothing
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
        { contractpayloadSrc      = namedSource "SimpleStorage.sol" "contract SimpleStorage { uint x; function SimpleStorage(uint _x) { x = _x; } function set(uint _x) { x = _x; } }"
        , contractpayloadCodePtr  = Nothing
        , contractpayloadContract = Nothing
        , contractpayloadArgs     = Just $ Map.fromList [("_x", ArgInt 1)]
        , contractpayloadValue    = Nothing
        , contractpayloadTxParams = Nothing
        , contractpayloadChainid  = Nothing
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
        , transferpayloadValue     = Strung 1000000
        , transferpayloadTxParams  = Nothing
        , transferpayloadChainid   = Nothing
        , transferpayloadMetadata  = Nothing
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
        , functionpayloadTxParams        = Nothing
        , functionpayloadChainid         = Nothing
        , functionpayloadMetadata        = Nothing
        }

data BlocChainOrTransactionResult = BlocChainResult ChainId
                                  | BlocTxResult BlocTransactionResult
                                  deriving (Eq, Show, Generic)

instance ToJSON BlocChainOrTransactionResult where
  toJSON (BlocChainResult cid) = toJSON cid
  toJSON (BlocTxResult btr) = toJSON btr

instance FromJSON BlocChainOrTransactionResult where
  parseJSON o = (BlocTxResult <$> parseJSON o)
            <|> (BlocChainResult <$> parseJSON o)
            <|> pure (error $ "fromJSON BlocChainOrTransactionResult: Expected Object or hex-encoded string, but got " ++ show o)

instance Arbitrary BlocChainOrTransactionResult where
  arbitrary = GR.genericArbitrary GR.uniform

instance ToSample BlocChainOrTransactionResult where
  toSamples _ = singleSample . BlocTxResult $ BlocTransactionResult
    { blocTransactionStatus = Success
    , blocTransactionHash = hash "foo"
    , blocTransactionTxResult = Nothing
    , blocTransactionData = Nothing
    }

instance ToSchema BlocChainOrTransactionResult where
  declareNamedSchema proxy = genericDeclareNamedSchema blocSchemaOptions proxy
    & mapped.schema.description ?~ "Bloc Chain or Transaction Result"
    & mapped.schema.example ?~ toJSON ex
    where
      ex :: BlocChainOrTransactionResult
      ex = BlocTxResult $ BlocTransactionResult
        { blocTransactionStatus = Success
        , blocTransactionHash = hash "foo"
        , blocTransactionTxResult = Nothing
        , blocTransactionData = Nothing
        }
