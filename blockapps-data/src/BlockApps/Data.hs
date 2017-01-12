{-# LANGUAGE
    DeriveGeneric
  , OverloadedLists
  , OverloadedStrings
#-}

module BlockApps.Data
  ( -- * Addresses
    Address (..)
  , addressString
  , stringAddress
  ) where

import Data.Aeson
import Data.LargeWord
import Data.Monoid
import qualified Data.Text as Text
import GHC.Generics
import Numeric
import Text.Read
import Web.FormUrlEncoded
import Web.HttpApiData

newtype Address = Address Word160 deriving (Eq,Show,Generic)
addressString :: Address -> String
addressString (Address address) = padZeros 20 (showHex address "")
stringAddress :: String -> Maybe Address
stringAddress string = Address . fromInteger <$> readMaybe ("0x" ++ string)
instance ToJSON Address where toJSON = toJSON . addressString
instance FromJSON Address where
  parseJSON value = do
    string <- parseJSON value
    case stringAddress string of
      Nothing -> fail $ "Could not decode Address: " <> string
      Just address -> return address
instance ToHttpApiData Address where
  toUrlPiece = Text.pack . addressString
instance FromHttpApiData Address where
  parseUrlPiece text = case stringAddress (Text.unpack text) of
    Nothing -> Left $ "Could not decode Address: " <> text
    Just address -> Right address
instance ToForm Address where
  toForm address = [("address", toQueryParam address)]
instance FromForm Address where fromForm = parseUnique "address"

-- helpers
padZeros :: Int -> String -> String
padZeros n string = replicate (n - length string) '0' ++ string
