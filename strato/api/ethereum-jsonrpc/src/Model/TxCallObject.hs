{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}

module Model.TxCallObject
  ( TxCallObject (..),
  )
where

import Blockchain.Strato.Model.Address (Address(..))
import Data.Aeson (FromJSON (..), ToJSON (..), genericToJSON, defaultOptions, Options(..), (.:?), (.!=), withObject)
import Data.Text (Text)
import GHC.Generics (Generic)
import Model.HexData (HexData(..))

data TxCallObject = TxCallObject
  { from :: Address,
    to :: Maybe Address,
    gas :: Text,
    gasPrice :: Text,
    value :: Text,
    data_ :: HexData
  }
  deriving (Show, Eq, Generic)

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
