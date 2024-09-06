{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DerivingStrategies #-}
{-# LANGUAGE DuplicateRecordFields #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedLists #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Bloc.API.Users
  ( BlocTransactionBodyResult (..),
    BlocTransactionUnsignedResult (..),
    BlocTransactionResult (..),
    BlocTransactionStatus (..),
    GetBlocTransactionResult,
    PostBlocTransactionResults,
    TransferParameters (..),
    ContractParameters (..),
    UploadListContract (..),
    ContractListParameters (..),
    TransferListParameters (..),
    FunctionListParameters (..),
    FunctionParameters (..),
    SendTransaction (..),
    MethodCall (..),
    BlocTransactionData (..),
    UploadContractDetails (..),
    uploadlistcontractChainid,
    uploadlistcontractTxParams,
    sendtransactionChainid,
    methodcallChainid,
    methodcallTxParams,
    sendtransactionTxParams,
  )
where

import qualified Bloc.API.DeprecatedPostTransaction as Deprecated
import Bloc.API.SwaggerSchema hiding (Header)
import Bloc.API.TypeWrappers
import Bloc.API.Utils
import BlockApps.Solidity.ArgValue
import BlockApps.Solidity.SolidityValue
import Blockchain.Data.Json (RawTransaction', UnsignedRawTransaction')
import Blockchain.Data.TransactionResult
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainId
import Blockchain.Strato.Model.Gas
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Nonce
import Blockchain.Strato.Model.Wei
import Blockchain.Strato.Model.Code (Code)
import Control.Lens (mapped)
import Control.Lens.Operators hiding ((.=))
import Control.Lens.TH
import Data.Aeson hiding (Success)
import Data.Aeson.Casing
import Data.Map (Map)
import qualified Data.Map as Map
import Data.Maybe
import Data.Source.Map
import Data.Text (Text)
import GHC.Generics
import qualified Generic.Random as GR
import Numeric.Natural
import Servant.API
import Servant.Docs
import Test.QuickCheck hiding (Failure, Success)

--------------------------------------------------------------------------------

-- | Routes and types

--------------------------------------------------------------------------------

data BlocTransactionStatus = Success | Failure | Pending deriving (Eq, Show, Generic)

instance Arbitrary BlocTransactionStatus where
  arbitrary = GR.genericArbitrary GR.uniform

instance FromJSON BlocTransactionStatus where
  parseJSON = genericParseJSON defaultOptions

instance ToJSON BlocTransactionStatus where
  toJSON = genericToJSON defaultOptions

instance ToSchema BlocTransactionStatus where
  declareNamedSchema proxy =
    genericDeclareNamedSchema blocSchemaOptions proxy
      & mapped . schema . description ?~ "Bloc Transaction Status"
      & mapped . schema . example ?~ toJSON Success

data BlocTransactionData
  = Send Deprecated.PostTransaction
  | Upload UploadContractDetails
  | Call [SolidityValue]
  deriving (Eq, Show, Generic)

data UploadContractDetails = UploadContractDetails
  { contractName :: Text,
    contractAccount :: Maybe Account
  }
  deriving (Show, Eq, Generic)

instance ToJSON UploadContractDetails where
  toJSON UploadContractDetails {..} =
    object $
      [ "name" .= contractName,
        "address" .= fmap _accountAddress contractAccount,
        "chainId" .= fmap _accountChainId contractAccount
      ]

instance FromJSON UploadContractDetails where
  parseJSON = withObject "UploadContractDetails" $ \obj ->
    UploadContractDetails
      <$> obj .: "name"
      <*> ( do
              mAddr <- obj .:? "address"
              case mAddr of
                Nothing -> pure Nothing
                Just addr -> Just . Account addr <$> (obj .:? "chainId")
          )

instance ToSample UploadContractDetails where toSamples _ = noSamples

instance Arbitrary UploadContractDetails where
  arbitrary = GR.genericArbitrary GR.uniform

instance ToSchema UploadContractDetails where
  declareNamedSchema proxy =
    genericDeclareNamedSchema blocSchemaOptions proxy
      & mapped . name ?~ "UploadContractDetails"
      & mapped . schema . description ?~ "Returned data from contract creation."
      & mapped . schema . example ?~ toJSON ex
    where
      ex :: UploadContractDetails
      ex =
        UploadContractDetails
          { contractName = "Example",
            contractAccount = Just $ Account (Address 0xdeadbeef) Nothing
          }

instance Arbitrary BlocTransactionData where
  arbitrary = GR.genericArbitrary GR.uniform

instance ToJSON BlocTransactionData where
  toJSON btd = case btd of
    Send transaction ->
      object
        [ "tag" .= ("Send" :: Text),
          "contents" .= (transaction :: Deprecated.PostTransaction)
        ]
    Upload details ->
      object
        [ "tag" .= ("Upload" :: Text),
          "contents" .= (details :: UploadContractDetails)
        ]
    Call solVals ->
      object
        [ "tag" .= ("Call" :: Text),
          "contents" .= (solVals :: [SolidityValue])
        ]

instance FromJSON BlocTransactionData where
  parseJSON = withObject "BlocTransactionData" $ \v -> do
    tag <- v .: "tag"
    case tag of
      ("Send" :: String) -> Send <$> v .: "contents"
      ("Upload" :: String) -> Upload <$> v .: "contents"
      _ -> Call <$> v .: "contents"

instance ToSample BlocTransactionData where
  toSamples _ =
    samples
      [ Send
          Deprecated.PostTransaction
            { Deprecated.posttransactionHash = hash "foo",
              Deprecated.posttransactionGasLimit = 100000,
              Deprecated.posttransactionCodeOrData = "Code or Data",
              Deprecated.posttransactionGasPrice = 1,
              Deprecated.posttransactionTo = Just $ Address 0xdeadbeef,
              Deprecated.posttransactionFrom = Address 0x12345678,
              Deprecated.posttransactionValue = Strung 0,
              Deprecated.posttransactionR = Hex 0xdeadbeef,
              Deprecated.posttransactionS = Hex 0xdeadbeef,
              Deprecated.posttransactionV = Hex 0x1c,
              Deprecated.posttransactionNonce = 9876,
              Deprecated.posttransactionChainId = Nothing,
              Deprecated.posttransactionMetadata = Nothing
            },
        Upload
          UploadContractDetails
            { contractName = "Example",
              contractAccount = Just $ Account (Address 0xdeadbeef) Nothing
            },
        Call [] -- probably make a better Call sample
      ]

instance ToSchema BlocTransactionData where
  declareNamedSchema proxy =
    genericDeclareNamedSchema blocSchemaOptions proxy
      & mapped . name ?~ "Bloc Transaction Data"
      & mapped . schema . description ?~ "Bloc Transaction Data"
      & mapped . schema . example ?~ toJSON ex
    where
      ex :: BlocTransactionData
      ex = Call [] -- probably make a better ToSchema example

data BlocTransactionBodyResult = BlocTransactionBodyResult
  { blocTransactionHash :: Keccak256,
    blocTransactionRaw :: Maybe RawTransaction'
  }
  deriving (Eq, Show, Generic)

data BlocTransactionUnsignedResult = BlocTransactionUnsignedResult
  { blocTransactionUnsignedHash :: Keccak256,
    blocTransactionUnsignedData :: Maybe UnsignedRawTransaction'
  }
  deriving (Eq, Show, Generic)

data BlocTransactionResult = BlocTransactionResult
  { blocTransactionStatus :: BlocTransactionStatus,
    blocTransactionHash :: Keccak256,
    blocTransactionTxResult :: Maybe TransactionResult,
    blocTransactionData :: Maybe BlocTransactionData
  }
  deriving (Eq, Show, Generic)

instance Arbitrary BlocTransactionResult where
  arbitrary = BlocTransactionResult <$> arbitrary <*> arbitrary <*> pure Nothing <*> arbitrary

instance ToJSON BlocTransactionResult where
  toJSON = genericToJSON (aesonDrop 15 camelCase)

instance FromJSON BlocTransactionResult where
  parseJSON = genericParseJSON (aesonDrop 15 camelCase)

instance ToJSON BlocTransactionBodyResult where
  toJSON = genericToJSON (aesonDrop 15 camelCase)

instance FromJSON BlocTransactionBodyResult where
  parseJSON = genericParseJSON (aesonDrop 15 camelCase)

instance ToSample BlocTransactionResult where
  toSamples _ =
    singleSample
      BlocTransactionResult
        { blocTransactionStatus = Success,
          blocTransactionHash = hash "foo",
          blocTransactionTxResult = Nothing,
          blocTransactionData = Nothing
        }

instance ToSample BlocTransactionBodyResult where
  toSamples _ =
    singleSample
      BlocTransactionBodyResult
        { blocTransactionHash = hash "foobarbaz",
          blocTransactionRaw = Nothing
        }

instance ToJSON BlocTransactionUnsignedResult where
  toJSON = genericToJSON (aesonDrop 23 camelCase)

instance FromJSON BlocTransactionUnsignedResult where
  parseJSON = genericParseJSON (aesonDrop 23 camelCase)

instance ToSample BlocTransactionUnsignedResult where
  toSamples _ =
    singleSample
      BlocTransactionUnsignedResult
        { blocTransactionUnsignedHash = hash "foobarbaz",
          blocTransactionUnsignedData = Nothing
        }

instance ToSchema BlocTransactionResult where
  declareNamedSchema proxy =
    genericDeclareNamedSchema blocSchemaOptions proxy
      & mapped . schema . description ?~ "Bloc Transaction Result"
      & mapped . schema . example ?~ toJSON ex
    where
      ex :: BlocTransactionResult
      ex =
        BlocTransactionResult
          { blocTransactionStatus = Success,
            blocTransactionHash = hash "foo",
            blocTransactionTxResult = Nothing,
            blocTransactionData = Nothing
          }

instance ToSchema BlocTransactionBodyResult where
  declareNamedSchema proxy =
    genericDeclareNamedSchema blocSchemaOptions proxy
      & mapped . schema . description ?~ "Bloc Transaction body result"
      & mapped . schema . example ?~ toJSON ex
    where
      ex :: BlocTransactionBodyResult
      ex = BlocTransactionBodyResult (hash "foobarbaz") Nothing -- TODO: replace Nothing with Something

instance ToSchema BlocTransactionUnsignedResult where
  declareNamedSchema proxy =
    genericDeclareNamedSchema blocSchemaOptions proxy
      & mapped . schema . description ?~ "Bloc Transaction unsigned result"
      & mapped . schema . example ?~ toJSON ex
    where
      ex :: BlocTransactionUnsignedResult
      ex = BlocTransactionUnsignedResult (hash "foobarbaz") Nothing -- TODO: replace Nothing with Something

type GetBlocTransactionResult =
  "transactions"
    :> Capture "hash" Keccak256
    :> "result"
    :> QueryFlag "resolve"
    :> Get '[JSON] BlocTransactionResult

type PostBlocTransactionResults =
  "transactions"
    :> "results"
    :> Header "Authorization" Text
    :> QueryFlag "resolve"
    :> ReqBody '[JSON] [Keccak256]
    :> Post '[JSON] [BlocTransactionResult]

instance ToParam (QueryFlag "resolve") where
  toParam _ =
    DocQueryParam "resolve" ["0", "1", ""] "flag for resolving a transaction result" Flag

instance ToParam (QueryParam "use_wallet" Bool) where
  toParam _ =
    DocQueryParam "use_wallet" [] "flag for overriding default user wallet behavior" Normal

--------------------------------------------------------------------------------

data TransferParameters = TransferParameters
  { fromAddress :: Address,
    toAddress :: Address,
    value :: Strung Natural,
    txParams :: Maybe TxParams,
    metadata :: Maybe (Map Text Text),
    chainId :: Maybe ChainId,
    resolve :: Bool
  }
  deriving (Eq, Show, Generic)

--------------------------------------------------------------------------------
data ContractParameters = ContractParameters
  { fromAddr :: Address,
    src :: SourceMap,
    contract :: Maybe Text,
    args :: Maybe (Map Text ArgValue),
    value :: Maybe (Strung Natural),
    txParams :: Maybe TxParams,
    metadata :: Maybe (Map Text Text),
    chainId :: Maybe ChainId,
    resolve :: Bool,
    ptr2Code :: Maybe Code
  }

--------------------------------------------------------------------------------
data UploadListContract = UploadListContract
  { uploadlistcontractContractName :: Text,
    uploadlistcontractSrc :: SourceMap,
    uploadlistcontractArgs :: Map Text ArgValue,
    _uploadlistcontractTxParams :: Maybe TxParams,
    uploadlistcontractValue :: Maybe (Strung Natural),
    _uploadlistcontractChainid :: Maybe ChainId,
    uploadlistcontractMetadata :: Maybe (Map Text Text),
    uploadlistcontractPtr2Code :: Maybe Code
  }
  deriving (Eq, Show, Generic)

makeLenses ''UploadListContract

instance Arbitrary UploadListContract where arbitrary = GR.genericArbitrary GR.uniform

instance ToJSON UploadListContract where
  toJSON UploadListContract {..} =
    object
      [ "contractName" .= uploadlistcontractContractName,
        "src" .= uploadlistcontractSrc,
        "args" .= uploadlistcontractArgs,
        "txParams" .= _uploadlistcontractTxParams,
        "value" .= uploadlistcontractValue,
        "chainid" .= _uploadlistcontractChainid,
        "metadata" .= uploadlistcontractMetadata,
        "ptr2code" .= uploadlistcontractPtr2Code
      ]

instance FromJSON UploadListContract where
  parseJSON (Object o) =
    UploadListContract
      <$> (o .: "contractName")
      <*> (fromMaybe mempty <$> o .:? "src")
      <*> (o .: "args")
      <*> (o .:? "txParams")
      <*> (o .:? "value")
      <*> (o .:? "chainid")
      <*> (o .:? "metadata")
      <*> (o .:? "ptr2Code")
  parseJSON o = fail $ "parseJSON UploadListContract: Expected Object, got " ++ show o

instance ToSchema UploadListContract where
  declareNamedSchema proxy =
    genericDeclareNamedSchema blocSchemaOptions proxy
      & mapped . schema . description ?~ "A contract in a list of to-upload contracts"
      & mapped . schema . example ?~ toJSON ex
    where
      ex :: UploadListContract
      ex =
        UploadListContract
          { uploadlistcontractContractName = "SampleContract",
            uploadlistcontractSrc = mempty,
            uploadlistcontractArgs = Map.fromList [("user", ArgString "Bob"), ("age", ArgInt 1)],
            _uploadlistcontractTxParams = Just $ TxParams (Just $ Gas 123) (Just $ Wei 345) Nothing,
            uploadlistcontractValue = Nothing,
            _uploadlistcontractChainid = Nothing,
            uploadlistcontractMetadata = Nothing,
            uploadlistcontractPtr2Code = Nothing
          }

data ContractListParameters = ContractListParameters
  { fromAddr :: Address,
    contracts :: [UploadListContract],
    chainId :: Maybe ChainId,
    resolve :: Bool
  }
  deriving (Eq, Show, Generic)

--------------------------------------------------------------------------------
data FunctionParameters = FunctionParameters
  { fromAddr :: Address,
    contractAddr :: Address,
    funcName :: Text,
    args :: Map Text ArgValue,
    value :: Maybe (Strung Natural),
    txParams :: Maybe TxParams,
    metadata :: Maybe (Map Text Text),
    chainId :: Maybe ChainId,
    resolve :: Bool
  }

--------------------------------------------------------------------------------
data SendTransaction = SendTransaction
  { sendtransactionToAddress :: Address,
    sendtransactionValue :: Strung Natural,
    _sendtransactionTxParams :: Maybe TxParams,
    _sendtransactionChainid :: Maybe ChainId,
    sendtransactionMetadata :: Maybe (Map Text Text)
  }
  deriving (Eq, Show, Generic)

makeLenses ''SendTransaction

instance Arbitrary SendTransaction where arbitrary = GR.genericArbitrary GR.uniform

instance ToJSON SendTransaction where
  toJSON = genericToJSON (aesonPrefix camelCase) {omitNothingFields = True}

instance FromJSON SendTransaction where
  parseJSON = genericParseJSON (aesonPrefix camelCase) {omitNothingFields = True}

newtype PostSendListResponse = PostSendListResponse
  { postsendlistresponseSenderBalance :: Text
  }
  deriving (Eq, Show, Generic)

instance ToJSON PostSendListResponse where
  toJSON = genericToJSON (aesonPrefix camelCase)

instance FromJSON PostSendListResponse where
  parseJSON = genericParseJSON (aesonPrefix camelCase)

instance ToSample PostSendListResponse where
  toSamples _ = noSamples

instance Arbitrary PostSendListResponse where
  arbitrary = GR.genericArbitrary GR.uniform

instance ToSchema PostSendListResponse where
  declareNamedSchema proxy =
    genericDeclareNamedSchema blocSchemaOptions proxy
      & mapped . name ?~ "Post Users Send List Response"
      & mapped . schema . description ?~ "Post Users Send List Response"
      & mapped . schema . example ?~ toJSON ex
    where
      ex :: PostSendListResponse
      ex =
        PostSendListResponse
          { postsendlistresponseSenderBalance = "1000"
          }

instance ToSchema SendTransaction where
  declareNamedSchema proxy =
    genericDeclareNamedSchema blocSchemaOptions proxy
      & mapped . name ?~ "Send Transaction"
      & mapped . schema . description ?~ "Single transaction for batch"
      & mapped . schema . example ?~ toJSON ex
    where
      ex :: SendTransaction
      ex =
        SendTransaction
          { sendtransactionToAddress = Address 0xdeadbeef,
            sendtransactionValue = Strung 100000000000000,
            _sendtransactionTxParams =
              Just
                ( TxParams
                    (Just $ Gas 123)
                    (Just $ Wei 345)
                    (Just $ Nonce 9876)
                ),
            _sendtransactionChainid = Nothing,
            sendtransactionMetadata = (Just $ Map.fromList [("purpose", "groceries")])
          }

data TransferListParameters = TransferListParameters
  { fromAddr :: Address,
    txs :: [SendTransaction],
    chainId :: Maybe ChainId,
    resolve :: Bool
  }
  deriving (Show, Eq)

--------------------------------------------------------------------------------

data PostUsersContractMethodListResponse
  = MethodHash Keccak256
  | -- | MethodResolved [SolidityValue]
    MethodResolved (Either MethodErrored [SolidityValue])
  deriving (Eq, Show, Generic)

instance Arbitrary PostUsersContractMethodListResponse where
  arbitrary = GR.genericArbitrary GR.uniform

instance ToJSON PostUsersContractMethodListResponse where
  toJSON mlr = case mlr of
    MethodHash kc ->
      object
        [ "tag" .= ("MethodHash" :: Text),
          "contents" .= (kc :: Keccak256)
        ]
    MethodResolved (Left err) ->
      object
        [ "tag" .= ("MethodResolved" :: Text),
          "contents" .= (err :: MethodErrored),
          "status" .= ("failed" :: Text)
        ]
    MethodResolved (Right solVals) ->
      object
        [ "tag" .= ("MethodResolved" :: Text),
          "contents" .= (solVals :: [SolidityValue]),
          "status" .= ("success" :: Text)
        ]

instance FromJSON PostUsersContractMethodListResponse where
  parseJSON = withObject "PostUsersContractMethodListResponse" $ \v -> do
    tag <- v .: "tag"
    case tag of
      ("MethodResolved" :: String) -> do
        status <- v .: "status"
        case status of
          ("success" :: String) -> MethodResolved <$> (Right <$> v .: "contents")
          ("fail" :: String) -> MethodResolved <$> (Left <$> v .: "contents")
          _ -> fail "failed to parseJSON on key `status` of PostUsersContractMethodListResponse"
      _ -> MethodHash <$> v .: "contents"

instance ToSample PostUsersContractMethodListResponse where
  toSamples _ =
    samples
      [ MethodHash (hash "foo"),
        MethodResolved $
          Right
            [ SolidityValueAsString "1",
              SolidityValueAsString "two",
              SolidityValueAsString "buckleMyShoe"
            ]
      ]

instance ToSchema PostUsersContractMethodListResponse where
  declareNamedSchema proxy =
    genericDeclareNamedSchema blocSchemaOptions proxy
      & mapped . name ?~ "Post Users Contract Method List Response"
      & mapped . schema . description ?~ "Post Users Contract Method List Response"
      & mapped . schema . example ?~ toJSON ex
    where
      ex :: PostUsersContractMethodListResponse
      ex =
        MethodResolved $
          Right
            [ SolidityValueAsString "1",
              SolidityValueAsString "two",
              SolidityValueAsString "buckleMyShoe"
            ]

instance Arbitrary MethodCall where arbitrary = GR.genericArbitrary GR.uniform

instance ToJSON MethodCall where
  toJSON = genericToJSON (aesonPrefix camelCase) {omitNothingFields = True}

instance FromJSON MethodCall where
  parseJSON = genericParseJSON (aesonPrefix camelCase) {omitNothingFields = True}

instance ToSchema MethodCall where
  declareNamedSchema proxy =
    genericDeclareNamedSchema blocSchemaOptions proxy
      & mapped . name ?~ "Method Call"
      & mapped . schema . description ?~ "Everything you'll need for a method call"
      & mapped . schema . example ?~ toJSON ex
    where
      ex :: MethodCall
      ex =
        MethodCall
          { _methodcallTxParams = Nothing,
            methodcallValue = Strung 1000000000,
            methodcallArgs = Map.fromList [("user", ArgString "Bob"), ("age", ArgInt 52)],
            methodcallMethodName = "getHoroscope",
            methodcallContractAddress = Address 0xdeadbeef,
            _methodcallChainid = Nothing,
            methodcallMetadata = Nothing
          }

data FunctionListParameters = FunctionListParameters
  { fromAddr :: Address,
    txs :: [MethodCall],
    chainId :: Maybe ChainId,
    resolve :: Bool
  }
  deriving (Show, Eq)

data MethodErrored = MethodErrored
  { erroredMethodCall :: MethodCall,
    errorMessage :: Text
  }
  deriving (Eq, Show, Generic)

instance Arbitrary MethodErrored where
  arbitrary = GR.genericArbitrary GR.uniform

instance ToJSON MethodErrored

instance FromJSON MethodErrored

methodErroredExample :: MethodErrored
methodErroredExample =
  MethodErrored
    { erroredMethodCall = exMethodCall,
      errorMessage =
        "Rejected from mempool at \
        \ Execution/Queued due to low account balance \
        \ (expected: 1234000000000100000000, actual: 999999999999995067249)"
    }
  where
    exMethodCall :: MethodCall
    exMethodCall =
      MethodCall
        { _methodcallTxParams = Nothing,
          methodcallValue = Strung 1000000000,
          methodcallArgs = Map.fromList [("user", ArgString "Bob"), ("age", ArgInt 52)],
          methodcallMethodName = "getHoroscope",
          methodcallContractAddress = Address 0xdeadbeef,
          _methodcallChainid = Nothing,
          methodcallMetadata = Nothing
        }

instance ToSample MethodErrored where
  toSamples _ = samples [methodErroredExample]

instance ToSchema MethodErrored where
  declareNamedSchema proxy =
    genericDeclareNamedSchema blocSchemaOptions proxy
      & mapped . name ?~ "Method Errored Response"
      & mapped . schema . description ?~ "response object when method fails in a methodList call"
      & mapped . schema . example ?~ toJSON methodErroredExample

data MethodCall = MethodCall
  { methodcallContractAddress :: Address,
    methodcallMethodName :: Text,
    methodcallArgs :: Map Text ArgValue,
    methodcallValue :: Strung Natural,
    _methodcallTxParams :: Maybe TxParams,
    _methodcallChainid :: Maybe ChainId,
    methodcallMetadata :: Maybe (Map Text Text)
  }
  deriving (Eq, Show, Generic)

makeLenses ''MethodCall
