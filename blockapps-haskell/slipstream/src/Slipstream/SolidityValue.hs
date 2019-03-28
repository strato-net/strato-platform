{-# LANGUAGE
      OverloadedStrings
    , RecordWildCards
    , DeriveGeneric
    , QuasiQuotes
    , ScopedTypeVariables
    , DataKinds
    , TemplateHaskell
    , FlexibleContexts
    , GeneralizedNewtypeDeriving
    , TupleSections
#-}

module Slipstream.SolidityValue where

import           BlockApps.Ethereum
import           BlockApps.Solidity.Value
import           BlockApps.Solidity.Type
import           Data.Aeson               hiding (Value)
import qualified Data.ByteString          as B
import qualified Data.ByteString.Char8    as BC
import           Data.Foldable            (toList)
import           Data.List
import qualified Data.Map                 as M
import           Data.Maybe               (fromMaybe, mapMaybe)
import           Data.Scientific          (floatingOrInteger)
import           Data.Text (Text)
import qualified Data.Text as Text
import           GHC.Generics
import           Text.Printf

data SolidityValue
  = SolidityValueAsString Text
  | SolidityBool Bool
  | SolidityNum Integer
  | SolidityArray [SolidityValue]
  | SolidityBytes  B.ByteString
  | SolidityObject [(Text, SolidityValue)]
  deriving (Eq,Show,Generic)

instance ToJSON SolidityValue where
  toJSON (SolidityValueAsString str) = toJSON str
  toJSON (SolidityBool boolean) = toJSON boolean
  toJSON (SolidityNum n) = toJSON . show $ n
  toJSON (SolidityArray array) = toJSON array
  toJSON (SolidityBytes bytes) = object
    [ "type" .= ("Buffer" :: Text)
    , "data" .= B.unpack bytes
    ]
  toJSON (SolidityObject namedItems) =
    object $ uncurry (.=) <$> namedItems

instance FromJSON SolidityValue where
  parseJSON (String str) = return $ SolidityValueAsString str
  parseJSON (Bool boolean) = return $ SolidityBool boolean
  parseJSON (Number sci) = return
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
    else
      fail "Failed to parse SolidityBytes"
  parseJSON _ = fail "Failed to parse solidity value"

valueToSolidityValue :: Value -> SolidityValue
valueToSolidityValue = fromMaybe (SolidityValueAsString "wut the fuck") . valueToSolidityValue'

valueToSolidityValue' :: Value -> Maybe SolidityValue
valueToSolidityValue' = \case
  SimpleValue (ValueBool x) -> Just $ SolidityBool x
  SimpleValue (ValueInt _ _ v) ->  Just $ SolidityNum $ toInteger v

  SimpleValue (ValueString s) -> Just $ SolidityValueAsString s
  SimpleValue (ValueAddress (Address addr)) ->
   Just $ SolidityValueAsString $ Text.pack $ printf "%040x" (fromIntegral addr::Integer)
  ValueContract (Address addr) ->
   Just $ SolidityValueAsString $ Text.pack $ printf "%040x" (fromIntegral addr::Integer)
  SimpleValue (ValueBytes _ bytes) -> Just $ SolidityValueAsString $ Text.pack $ BC.unpack bytes
  ValueEnum _ _ index              -> Just $ SolidityValueAsString $ Text.pack $ show index
  ValueFunction _ paramTypes returnTypes -> Just $
   SolidityValueAsString $ Text.pack $ "function ("
                           ++ intercalate "," (map (formatType . snd) paramTypes)
                           ++ ") returns ("
                           ++ intercalate "," (map (formatType . snd) returnTypes)
                           ++ ")"

  ValueArrayFixed _ values -> Just . SolidityArray . mapMaybe valueToSolidityValue' $ values
  ValueArrayDynamic values -> Just . SolidityArray . mapMaybe valueToSolidityValue' $ unsparse values
  -- TODO(tim): What if struct declaration order is needed here?
  ValueStruct namedItems -> Just . SolidityObject . M.toList $ M.mapMaybe valueToSolidityValue' namedItems
  ValueMapping ms -> Just . SolidityObject $ mapMaybe convertBoth (M.toList ms)
  ValueArraySentinel{} -> Nothing

 where convertBoth :: (SimpleValue, Value) -> Maybe (Text, SolidityValue)
       convertBoth (sv, v) = (simpleValueToText sv, ) <$> valueToSolidityValue' v
