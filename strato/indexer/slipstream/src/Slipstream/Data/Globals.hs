{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Slipstream.Data.Globals (
  Globals(..),
  TableColumns,
  TableName(..),
  parseStringToTableName
  ) where

import           Control.DeepSeq
import           Data.Cache.LRU
import qualified Data.Map.Strict     as M
import qualified Data.Set            as S
import qualified Data.Text           as T 
import           GHC.Generics
import           Text.Regex.Posix


import           BlockApps.Solidity.Value
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.CodePtr
import           Slipstream.Data.GlobalsColdStorage (Handle)


instance NFData (LRU key val) where
  rnf = (`seq` ()) -- LRU is already pretty strict

instance NFData (TableName) where
  rnf = (`seq` ())


data Globals = Globals { createdTables :: M.Map TableName TableColumns
                       , createdInstances :: S.Set CodePtr -- lets us avoid an extra bloc call
                       , contractStates :: LRU Account [(T.Text, Value)]
                       , csHandle :: Handle
                       } deriving (Generic, NFData)

data TableName = 
    IndexTableName
      { itOrganization :: T.Text
      , itApplication  :: T.Text
      , itContractName :: T.Text
      }
  | HistoryTableName -- technically the same as index, but logically different
      { htOrganization :: T.Text
      , htApplication  :: T.Text
      , htContractName :: T.Text
      }
  | EventTableName
      { etOrganization :: T.Text
      , etApplication  :: T.Text
      , etContractName :: T.Text
      , etEventName    :: T.Text
      } 
  | MappingTableName
      { mtOrganization :: T.Text
      , mtApplication  :: T.Text
      , mtContractName :: T.Text
      , mtMappingName  :: T.Text
      } deriving (Show, Eq, Ord)

type TableColumns = [T.Text]

textArrToHistoryTableName :: [T.Text]  -> TableName
textArrToHistoryTableName [contract]           = HistoryTableName T.empty T.empty  contract
textArrToHistoryTableName [org, contract]      = HistoryTableName  org  T.empty  contract
textArrToHistoryTableName [org, app, contract] = HistoryTableName  org  app  contract
textArrToHistoryTableName _ = error "whoops"


textArrToIndexTableName :: [T.Text]  -> TableName
textArrToIndexTableName [contract]           = IndexTableName T.empty T.empty  contract
textArrToIndexTableName [org, contract]      = IndexTableName  org  T.empty  contract
textArrToIndexTableName [org, app, contract] = IndexTableName  org  app  contract
textArrToIndexTableName _ = error "whoops"

textArrToMappingTableName :: [T.Text]  -> TableName
textArrToMappingTableName [mapping]                    = MappingTableName T.empty T.empty T.empty mapping
textArrToMappingTableName [contract,mapping]           = MappingTableName T.empty T.empty  contract mapping
textArrToMappingTableName [org, contract,mapping]      = MappingTableName  org  T.empty  contract mapping
textArrToMappingTableName [org, app, contract,mapping] = MappingTableName  org  app  contract mapping
textArrToMappingTableName _ = error "whoops"
  
textArrToEventTableName :: [T.Text]  -> TableName
textArrToEventTableName [contract, eventName]           = EventTableName T.empty T.empty contract eventName
textArrToEventTableName [org, contract, eventName]      = EventTableName org T.empty contract eventName
textArrToEventTableName [org, app, contract, eventName] = EventTableName org app contract eventName
textArrToEventTableName _ = error "whoops"

period :: String
period = "\\."

history :: String         
history = "history@" 

mappingS :: String
mappingS = "mapping@"

parseStringToTableName :: String -> TableName
parseStringToTableName bs
    | bs =~ period  :: Bool = let (tableStuff, _, eventName) = bs =~ period  :: (String, String, String)
                                 in textArrToEventTableName $ (T.splitOn (T.pack "-") $ T.pack tableStuff ) ++ [(T.pack eventName)]
    | bs =~ history :: Bool = let (_, _, tableStuff) = bs =~ history  :: (String, String, String) 
                                 in textArrToHistoryTableName $ T.splitOn  (T.pack "-") $ T.pack tableStuff
    | bs =~ mappingS :: Bool = let (_, _, tableStuff) = bs =~ mappingS  :: (String, String, String) 
                                 in textArrToMappingTableName $ T.splitOn  (T.pack "-") $ T.pack tableStuff      
    | otherwise                = textArrToIndexTableName $ T.splitOn (T.pack "-") (T.pack bs)                                           
        
