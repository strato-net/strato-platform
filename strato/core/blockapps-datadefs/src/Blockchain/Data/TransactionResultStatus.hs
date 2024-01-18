{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Data.TransactionResultStatus where

import Control.DeepSeq
import Data.Aeson hiding (Success)
import Data.Binary
import Database.Persist.TH
import GHC.Generics
import qualified Generic.Random as GR
import Test.QuickCheck (Arbitrary (..))

data TransactionResultStatus
  = Success
  | Failure
      { trfStage :: String,
        trfQueue :: Maybe String,
        trfType :: TransactionFailureType,
        trfExpectation :: Maybe Integer,
        trfReality :: Maybe Integer,
        trfDetails :: Maybe String
      }
  deriving (Eq, Read, Show, Generic, NFData)

data TransactionFailureType
  = IncorrectChainId
  | IncorrectNonce
  | InsufficientFunds
  | IntrinsicGasExceedsLimit
  | TrumpedByMoreLucrative
  | ExecutionFailure String
  | MissingCode
  | InvalidPragmaType
  | NonceLimitError
  | TXSizeLimitError
  | GasLimitError
  | KnownFailedTXError
  deriving (Eq, Read, Show, Generic, NFData)

derivePersistField "TransactionResultStatus"
derivePersistField "TransactionFailureType"

instance Arbitrary TransactionResultStatus where
  arbitrary = GR.genericArbitrary GR.uniform

instance Binary TransactionResultStatus

instance FromJSON TransactionResultStatus where
  parseJSON (String "success") = pure Success
  parseJSON x = flip (withObject "Failure") x $ \v ->
    Failure
      <$> v .: "stage"
      <*> v .:? "queue"
      <*> v .: "type"
      <*> v .:? "expectation"
      <*> v .:? "reality"
      <*> v .:? "details"

instance ToJSON TransactionResultStatus where
  toJSON Success = String "success"
  toJSON Failure {..} =
    object $
      [ "stage" .= trfStage,
        "type" .= trfType
      ]
        ++ maybe [] (pure . ("queue" .=)) trfQueue
        ++ maybe [] (pure . ("expectation" .=)) trfExpectation
        ++ maybe [] (pure . ("reality" .=)) trfReality
        ++ maybe [] (pure . ("details" .=)) trfDetails

instance Binary TransactionFailureType

instance FromJSON TransactionFailureType

instance ToJSON TransactionFailureType

instance Arbitrary TransactionFailureType where
  arbitrary = GR.genericArbitrary GR.uniform
