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
  toJSON (SolidityNum n) = toJSON n
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
valueToSolidityValue (SimpleValue (ValueBool x)) = SolidityBool x

valueToSolidityValue (SimpleValue (ValueInt8 v)) =  SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueInt16 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueInt24 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueInt32 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueInt40 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueInt48 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueInt56 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueInt64 v)) = SolidityNum $ toInteger v

valueToSolidityValue (SimpleValue (ValueInt72 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueInt80 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueInt88 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueInt96 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueInt104 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueInt112 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueInt120 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueInt128 v)) = SolidityNum $ toInteger v

valueToSolidityValue (SimpleValue (ValueInt136 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueInt144 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueInt152 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueInt160 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueInt168 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueInt176 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueInt184 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueInt192 v)) = SolidityNum $ toInteger v

valueToSolidityValue (SimpleValue (ValueInt200 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueInt208 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueInt216 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueInt224 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueInt232 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueInt240 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueInt248 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueInt256 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueInt v)) = SolidityNum $ toInteger v

valueToSolidityValue (SimpleValue (ValueUInt8 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueUInt16 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueUInt24 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueUInt32 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueUInt40 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueUInt48 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueUInt56 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueUInt64 v)) = SolidityNum $ toInteger v

valueToSolidityValue (SimpleValue (ValueUInt72 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueUInt80 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueUInt88 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueUInt96 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueUInt104 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueUInt112 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueUInt120 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueUInt128 v)) = SolidityNum $ toInteger v

valueToSolidityValue (SimpleValue (ValueUInt136 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueUInt144 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueUInt152 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueUInt160 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueUInt168 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueUInt176 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueUInt184 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueUInt192 v)) = SolidityNum $ toInteger v

valueToSolidityValue (SimpleValue (ValueUInt200 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueUInt208 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueUInt216 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueUInt224 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueUInt232 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueUInt240 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueUInt248 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueUInt256 v)) = SolidityNum $ toInteger v
valueToSolidityValue (SimpleValue (ValueUInt v)) = SolidityNum $ toInteger v




valueToSolidityValue (SimpleValue (ValueString s)) = SolidityValueAsString s
valueToSolidityValue (SimpleValue (ValueAddress (Address addr))) =
  SolidityValueAsString $ Text.pack $ printf "%040x" (fromIntegral addr::Integer)
valueToSolidityValue (ValueContract (Address addr)) =
  SolidityValueAsString $ Text.pack $ printf "%040x" (fromIntegral addr::Integer)
valueToSolidityValue (ValueArrayFixed _ values) = SolidityArray $ map valueToSolidityValue values
valueToSolidityValue (ValueArrayDynamic values) = SolidityArray $ map valueToSolidityValue values
valueToSolidityValue (SimpleValue (ValueBytes bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes1 byte)) = SolidityValueAsString $ Text.pack $ BC.unpack $ B.pack [byte]
valueToSolidityValue (SimpleValue (ValueBytes2 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes3 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes4 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes5 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes6 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes7 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes8 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes9 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes10 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes11 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes12 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes13 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes14 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes15 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes16 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes17 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes18 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes19 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes20 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes21 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes22 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes23 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes24 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes25 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes26 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes27 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes28 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes29 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes30 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes31 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (SimpleValue (ValueBytes32 bytes)) = SolidityValueAsString $ Text.pack $ BC.unpack bytes
valueToSolidityValue (ValueEnum _ _ index)              = SolidityValueAsString $ Text.pack $ show index
valueToSolidityValue (ValueStruct namedItems) =
  SolidityObject $ map (fmap valueToSolidityValue) namedItems
valueToSolidityValue (ValueFunction _ paramTypes returnTypes) =
  SolidityValueAsString $ Text.pack $ "function ("
                          ++ intercalate "," (map (formatType . snd) paramTypes)
                          ++ ") returns ("
                          ++ intercalate "," (map (formatType . snd) returnTypes)
                          ++ ")"
