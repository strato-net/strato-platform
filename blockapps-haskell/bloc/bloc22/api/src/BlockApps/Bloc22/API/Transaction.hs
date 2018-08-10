{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE DataKinds                  #-}
{-# LANGUAGE DeriveGeneric              #-}
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
--import           Data.Aeson.Casing
--import qualified Data.ByteString.Lazy               as ByteString.Lazy
import           Data.Map                           (Map)
--import qualified Data.Map                           as Map
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

data BlocTransactionType = CONTRACT | TRANSFER | FUNCTION deriving (Eq, Show, Generic)

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
  :> Post '[JSON] BlocTransactionResult

data PostBlocTransactionRequest = PostBlocTransactionRequest
  { postbloctransactionrequestTransactionType :: BlocTransactionType
  , postbloctransactionrequestPayload         :: BlocTransactionPayload
  , postbloctransactionrequestTxParams        :: Maybe TxParams
  } deriving (Eq, Show, Generic)

--instance Arbitrary PostBlocTransactionRequest where 
  --arbitrary = genericArbitrary uniform

instance ToJSON PostBlocTransactionRequest where

instance FromJSON PostBlocTransactionRequest where

instance ToSample PostBlocTransactionRequest where
  toSamples _ = noSamples

instance ToSchema PostBlocTransactionRequest where

data BlocTransactionPayload = 
  ContractPayload {
    contractpayloadSrc      :: Text
  , contractpayloadContract :: Maybe Text
  , contractpayloadArgs     :: Maybe (Map Text ArgValue)
  , contractpayloadValue    :: Maybe (Strung Natural)
  } |
  TransferPayload {
    transferpayloadToAddress :: Address
  , transferpayloadValue     :: Strung Natural
  } |
  FunctionPayload {
    functionpayloadContractName    :: ContractName
  , functionpayloadContractAddress :: Address
  , functionpayloadMethod          :: Text
  , functionpayloadArgs            :: Map Text ArgValue
  , functionpayloadValue           :: Maybe (Strung Natural) 
  } deriving (Eq, Show, Generic)

instance ToJSON BlocTransactionPayload where

instance FromJSON BlocTransactionPayload where

instance ToSchema BlocTransactionPayload where
