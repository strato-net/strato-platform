{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Slipstream.Data.Globals (
  Globals(..),
  TableColumns,
  TableName(..),
  stringArrToHistoryTableName,
  stringArrToIndexTableName,
  stringArrToEventTableName,
  parseStringToTableName
  ) where

import           Control.DeepSeq
import           Data.Cache.LRU
import qualified Data.HashMap.Strict as HM
import qualified Data.Map.Strict     as M
import qualified Data.Set            as S
import qualified Data.Text           as T 
import           GHC.Generics
import           Text.Regex.Posix


import           BlockApps.Solidity.Value
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.CodePtr
import           Blockchain.Strato.Model.Keccak256
import           Slipstream.Data.GlobalsColdStorage (Handle)


instance NFData (LRU key val) where
  rnf = (`seq` ()) -- LRU is already pretty strict

instance NFData (TableName) where
  rnf = (`seq` ())


data Globals = Globals { createdTables :: M.Map TableName TableColumns
                       , historyList :: M.Map TableName Bool
                       , createdInstances :: S.Set CodePtr -- lets us avoid an extra bloc call
                       , solidVMInfo :: HM.HashMap Keccak256 (M.Map T.Text CodePtr)
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
      } deriving (Show, Eq, Ord)

type TableColumns = [T.Text]

stringArrToHistoryTableName :: [T.Text]  -> TableName
stringArrToHistoryTableName [contract]           = HistoryTableName T.empty T.empty  contract
stringArrToHistoryTableName [org, contract]      = HistoryTableName  org  contract  contract
stringArrToHistoryTableName [org, app, contract] = HistoryTableName  org  app  contract
stringArrToHistoryTableName _ = error "whoops"


stringArrToIndexTableName :: [T.Text]  -> TableName
stringArrToIndexTableName [contract]           = IndexTableName T.empty T.empty  contract
stringArrToIndexTableName [org, contract]      = IndexTableName  org  contract  contract
stringArrToIndexTableName [org, app, contract] = IndexTableName  org  app  contract
stringArrToIndexTableName _ = error "whoops"
  
stringArrToEventTableName :: [T.Text]  -> TableName
stringArrToEventTableName [contract, eventName]           = EventTableName T.empty T.empty contract eventName
stringArrToEventTableName [org, contract, eventName]      = EventTableName org contract contract eventName
stringArrToEventTableName [org, app, contract, eventName] = EventTableName org app contract eventName
stringArrToEventTableName _ = error "whoops"

period :: String
period = "\\."

history :: String         
history = "history@" 

parseStringToTableName :: String -> TableName
parseStringToTableName bs
    | bs =~ period  :: Bool = let (tableStuff, _, eventName) = bs =~ period  :: (String, String, String)
                                 in stringArrToEventTableName $ (T.splitOn (T.pack "-") $ T.pack tableStuff ) ++ [(T.pack eventName)]
    | bs =~ history :: Bool = let (_, _, tableStuff) = bs =~ history  :: (String, String, String) 
                                 in stringArrToHistoryTableName $ T.splitOn  (T.pack "-") $ T.pack tableStuff
    | otherwise                = stringArrToIndexTableName $ T.splitOn (T.pack "-") (T.pack bs)                                           
        
