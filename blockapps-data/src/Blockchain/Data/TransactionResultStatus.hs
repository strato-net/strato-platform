{-# LANGUAGE DeriveGeneric   #-}
{-# LANGUAGE TemplateHaskell #-}
module Blockchain.Data.TransactionResultStatus where

import           Data.Aeson
import           Database.Persist
import           Database.Persist.Quasi
import           Database.Persist.TH

import           GHC.Generics

data TransactionResultStatus = Success
                             | Failure { trfStage       :: String
                                       , trfQueue       :: String
                                       , trfCulprit     :: String
                                       , trfExpectation :: Maybe Integer
                                       , trfReality     :: Maybe Integer
                                       }
                             deriving (Eq, Read, Show, Generic)

derivePersistField "TransactionResultStatus"
instance FromJSON TransactionResultStatus
instance ToJSON   TransactionResultStatus