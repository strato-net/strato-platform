{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Solidity.ArgValue where

import           ClassyPrelude                ((<>))
import           Control.Lens                 ((&), (?~))
import           Data.Aeson
import           Data.Swagger
import           Data.Text
import qualified Data.Text as Text
import           Data.Vector
import           Test.QuickCheck

data ArgValue
  = ArgInt Integer
  | ArgBool Bool
  | ArgString Text
  | ArgArray (Vector ArgValue)
  deriving (Eq,Show)

instance Arbitrary ArgValue where
  arbitrary = elements [ArgInt 5,ArgBool True,ArgBool False,ArgString "arggg"]

instance FromJSON ArgValue where
  parseJSON = \case
    Bool x -> return $ ArgBool x
    Number x -> return $ ArgInt (round x)
    String x -> return $ ArgString x
    Array xs -> ArgArray <$> traverse parseJSON xs
    Null -> fail "parsing JSON for ArgValue: encountered Null"
    Object _ -> fail "parsing JSON for ArgValue: encountered Object"

instance ToJSON ArgValue where
  toJSON = \case
    ArgInt x -> Number (fromIntegral x)
    ArgBool x -> Bool x
    ArgString x -> String x
    ArgArray xs -> Array (fmap toJSON xs)

instance ToSchema ArgValue where
  declareNamedSchema = pure . pure $
    NamedSchema (Just "Solidity Argument Value") $ mempty
      & description ?~ "A Solidity argument value"
      & example ?~ toJSON (ArgInt 5)

argValueToText :: ArgValue -> Text
argValueToText = \case
  ArgInt x -> Text.pack (show x)
  ArgBool x -> if x then "true" else "false"
  ArgString x -> x
  ArgArray xs -> "["
    <> Text.intercalate "," (toList (fmap argValueToText xs))
    <> "]"
