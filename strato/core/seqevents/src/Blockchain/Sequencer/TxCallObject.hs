{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Sequencer.TxCallObject
  ( TxCallObject (..),
  )
where

import Blockchain.Sequencer.HexData (HexData(..))
import Blockchain.Strato.Model.Address (Address(..))
import Data.Aeson (FromJSON (..), ToJSON (..), genericToJSON, defaultOptions, Options(..), (.:?), (.!=), withObject)
import Data.Binary
import Data.Data (Data)
import Data.Text (Text)
import GHC.Generics (Generic)

data TxCallObject = TxCallObject
  { from :: Address,
    to :: Maybe Address,
    gas :: Text,
    gasPrice :: Text,
    value :: Text,
    data_ :: HexData
  }
  deriving (Show, Read, Eq, Data, Generic)

instance Binary TxCallObject

stripUnderscore :: String -> String
stripUnderscore s = if last s == '_' then init s else s

instance FromJSON TxCallObject where
  parseJSON = withObject "TxCallObject" $ \o ->
    TxCallObject
      <$> o .:? "from" .!= Address 0
      <*> o .:? "to"
      <*> o .:? "gas" .!= "0x0"
      <*> o .:? "gasPrice" .!= "0x0"
      <*> o .:? "value" .!= "0x0"
      <*> o .:? "data" .!= HexData mempty

instance ToJSON TxCallObject where
  toJSON = genericToJSON defaultOptions {fieldLabelModifier = stripUnderscore}
