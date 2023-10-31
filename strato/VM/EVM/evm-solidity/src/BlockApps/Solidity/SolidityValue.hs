{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Solidity.SolidityValue where

import Control.Lens ((&), (?~))
import Data.Aeson
import qualified Data.Aeson.Key as DAK
import qualified Data.Bifunctor as BF
import Data.ByteString (ByteString)
import qualified Data.ByteString as ByteString
import Data.Foldable
import Data.Swagger
import Data.Text (Text)
import GHC.Generics
import Test.QuickCheck
import Test.QuickCheck.Instances ()

data SolidityValue
  = SolidityValueAsString Text
  | SolidityBool Bool
  | SolidityArray [SolidityValue]
  | SolidityBytes ByteString
  | SolidityObject [(Text, SolidityValue)]
  deriving (Eq, Show, Generic)

instance ToJSON SolidityValue where
  toJSON (SolidityValueAsString str) = toJSON str
  toJSON (SolidityBool boolean) = toJSON boolean
  toJSON (SolidityArray array) = toJSON array
  toJSON (SolidityBytes bytes) =
    object
      [ "type" .= ("Buffer" :: Text),
        "data" .= ByteString.unpack bytes
      ]
  toJSON (SolidityObject namedItems) =
    object $ uncurry (.=) <$> map (BF.first DAK.fromText) namedItems

instance FromJSON SolidityValue where
  parseJSON (String str) = return $ SolidityValueAsString str
  parseJSON (Bool boolean) = return $ SolidityBool boolean
  parseJSON (Array array) = SolidityArray <$> traverse parseJSON (toList array)
  --TODO - figure out how to decode a struct....  it looks to me like it could conflict with thie SolidityBytes thing
  parseJSON (Object obj) = do
    ty <- obj .: "type"
    if ty == ("Buffer" :: Text)
      then do
        bytes <- obj .: "data"
        return $ SolidityBytes (ByteString.pack bytes)
      else fail "Failed to parse SolidityBytes"
  parseJSON _ = fail "Failed to parse solidity value"

instance Arbitrary SolidityValue where
  arbitrary = return (SolidityBool True)

instance ToSchema SolidityValue where
  declareNamedSchema =
    pure . pure $
      NamedSchema (Just "Solidity Value") $
        mempty
          & description ?~ "A Solidity return type value"
          & example ?~ toJSON (SolidityBool True)
