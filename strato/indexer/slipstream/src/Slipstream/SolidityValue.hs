{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}

module Slipstream.SolidityValue
  ( SolidityValue (..),
    valueToSolidityValue,
  )
where

import BlockApps.Solidity.Type
import BlockApps.Solidity.Value
import Blockchain.Strato.Model.Address
import Data.Aeson hiding (Value)
import qualified Data.Aeson.Key as DAK
import qualified Data.Bifunctor as BF
import qualified Data.ByteString as B
import Data.Foldable (toList)
import Data.List
import qualified Data.Map as M
import Data.Maybe (mapMaybe)
import Data.Scientific (floatingOrInteger)
import Data.Text (Text)
import qualified Data.Text as Text
import Data.Text.Encoding (decodeUtf8)
import GHC.Generics
import Text.Printf

data SolidityValue
  = SolidityValueAsString Text
  | SolidityBool Bool
  | SolidityNum Integer
  | SolidityArray [SolidityValue]
  | SolidityBytes B.ByteString
  | SolidityObject [(Text, SolidityValue)]
  deriving (Eq, Show, Generic)

instance ToJSON SolidityValue where
  toJSON (SolidityValueAsString str) = toJSON str
  toJSON (SolidityBool boolean) = toJSON boolean
  toJSON (SolidityNum n) = toJSON . show $ n
  toJSON (SolidityArray array) = toJSON array
  toJSON (SolidityBytes bytes) =
    object
      [ "type" .= ("Buffer" :: Text),
        "data" .= B.unpack bytes
      ]
  toJSON (SolidityObject namedItems) =
    object $ uncurry (.=) . BF.first DAK.fromText <$> namedItems

instance FromJSON SolidityValue where
  parseJSON (String str) = return $ SolidityValueAsString str
  parseJSON (Bool boolean) = return $ SolidityBool boolean
  parseJSON (Number sci) =
    return
      . SolidityNum
      . either (round :: Double -> Integer) id
      $ floatingOrInteger sci
  parseJSON (Array array) = SolidityArray <$> traverse parseJSON (toList array)
  --TODO - figure out how to decode a struct....  it looks to me like it could conflict with thie SolidityBytes thing
  parseJSON (Object obj) = do
    ty <- obj .: "type"
    if ty == ("Buffer" :: Text)
      then do
        bytes <- obj .: "data"
        return $ SolidityBytes (B.pack bytes)
      else fail "Failed to parse SolidityBytes"
  parseJSON _ = fail "Failed to parse solidity value"

valueToSolidityValue :: Value -> SolidityValue
valueToSolidityValue v =
  case (valueToSolidityValue' v) of
    Just sv -> sv
    Nothing -> case v of
      -- This would be better handled by Value synthesis, but it seems difficult
      -- to distinguish the length of a nested array and an unaggregated sentinel.
      ValueArraySentinel len -> SolidityArray $ replicate len $ SolidityValueAsString "0"
      _ -> error $ "internal error: unanticpated problem with value construction: " ++ show v

valueToSolidityValue' :: Value -> Maybe SolidityValue
valueToSolidityValue' = \case
  SimpleValue (ValueBool x) -> Just $ SolidityBool x
  SimpleValue (ValueInt _ _ v) -> Just $ SolidityNum $ toInteger v
  SimpleValue (ValueString s) -> Just $ SolidityValueAsString s
  SimpleValue (ValueDecimal v) -> Just $ SolidityValueAsString $ decodeUtf8 v
  SimpleValue (ValueAddress (Address addr)) ->
    Just $ SolidityValueAsString $ Text.pack $ printf "%040x" (fromIntegral addr :: Integer)
  SimpleValue (ValueAccount acct) ->
    Just $ SolidityValueAsString $ Text.pack $ show acct
  ValueContract acct ->
    Just $ SolidityValueAsString $ Text.pack $ show acct
  SimpleValue (ValueBytes _ bytes) -> Just $ SolidityValueAsString $ decodeUtf8 bytes
  ValueEnum _ _ index -> Just $ SolidityValueAsString $ Text.pack $ show index
  ValueFunction _ paramTypes returnTypes ->
    Just $
      SolidityValueAsString $
        Text.pack $
          "function ("
            ++ intercalate "," (map (formatType . snd) paramTypes)
            ++ ") returns ("
            ++ intercalate "," (map (formatType . snd) returnTypes)
            ++ ")"
  ValueArrayFixed _ values -> Just . SolidityArray . mapMaybe valueToSolidityValue' $ values
  ValueArrayDynamic values -> Just . SolidityArray . mapMaybe valueToSolidityValue' $ unsparse values
  -- TODO(tim): What if struct declaration order is needed here?
  ValueStruct namedItems -> Just . SolidityObject . M.toList $ M.mapMaybe valueToSolidityValue' namedItems
  ValueMapping ms -> Just . SolidityObject $ mapMaybe convertBoth (M.toList ms)
  ValueArraySentinel {} -> Nothing
  ValueVariadic values -> Just . SolidityArray . mapMaybe valueToSolidityValue' $ values
  where
    convertBoth :: (SimpleValue, Value) -> Maybe (Text, SolidityValue)
    convertBoth (sv, v) = (simpleValueToText sv,) <$> valueToSolidityValue' v
