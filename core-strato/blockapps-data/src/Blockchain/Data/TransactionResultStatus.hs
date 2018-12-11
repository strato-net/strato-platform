{-# LANGUAGE DeriveGeneric     #-}
{-# LANGUAGE DeriveAnyClass    #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards   #-}
{-# LANGUAGE TemplateHaskell   #-}
module Blockchain.Data.TransactionResultStatus where

import           Control.DeepSeq
import           Data.Aeson          hiding (Success)
import           Data.Maybe          (maybe)
import           Database.Persist.TH
import           GHC.Generics

data TransactionResultStatus = Success
                             | Failure { trfStage       :: String
                                       , trfQueue       :: Maybe String
                                       , trfType        :: TransactionFailureType
                                       , trfExpectation :: Maybe Integer
                                       , trfReality     :: Maybe Integer
                                       , trfDetails     :: Maybe String
                                       }
                             deriving (Eq, Read, Show, Generic, NFData)

data TransactionFailureType = IncorrectNonce
                            | InsufficientFunds
                            | IntrinsicGasExceedsLimit
                            | TrumpedByMoreLucrative
                            | ExecutionFailure String
                            deriving (Eq, Read, Show, Generic, NFData)

derivePersistField "TransactionResultStatus"
derivePersistField "TransactionFailureType"

instance FromJSON TransactionResultStatus where
    parseJSON (String "success") = pure Success
    parseJSON x = flip (withObject "Failure") x $ \v -> Failure
        <$> v .:  "stage"
        <*> v .:? "queue"
        <*> v .:  "type"
        <*> v .:? "expectation"
        <*> v .:? "reality"
        <*> v .:? "details"

instance ToJSON   TransactionResultStatus where
    toJSON Success     = String "success"
    toJSON Failure{..} = object $ [ "stage" .= trfStage
                                  , "type"  .= trfType
                                  ]
                                ++ maybe [] (pure . ("queue" .=)) trfQueue
                                ++ maybe [] (pure . ("expectation" .=)) trfExpectation
                                ++ maybe [] (pure . ("reality" .=))     trfReality
                                ++ maybe [] (pure . ("details" .=))     trfDetails

instance FromJSON TransactionFailureType
instance ToJSON   TransactionFailureType
