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

module Slipstream.SolidityValue2 where

import qualified Data.ByteString.Char8 as BC
import BlockApps.Ethereum
import BlockApps.Solidity.Value
import BlockApps.Solidity.Type
import GHC.Generics
import qualified Data.ByteString as B
import qualified Data.Text as Text
import Data.List
import Text.Printf

data SolidityValue2
  = SolidityValueAsString2 Text.Text
  | SolidityBool2 Bool
  | SolidityNum Integer
  | SolidityArray2 [SolidityValue2]
  | SolidityBytes2  B.ByteString
  | SolidityObject2 [(Text.Text, SolidityValue2)]
  deriving (Eq,Show,Generic)

valueToSolidityValue2 :: Value -> SolidityValue2
valueToSolidityValue2 (SimpleValue (ValueBool x)) = SolidityBool2 x

valueToSolidityValue2 (SimpleValue (ValueInt8 v)) =  SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueInt16 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueInt24 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueInt32 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueInt40 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueInt48 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueInt56 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueInt64 v)) = SolidityNum $ toInteger v

valueToSolidityValue2 (SimpleValue (ValueInt72 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueInt80 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueInt88 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueInt96 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueInt104 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueInt112 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueInt120 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueInt128 v)) = SolidityNum $ toInteger v

valueToSolidityValue2 (SimpleValue (ValueInt136 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueInt144 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueInt152 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueInt160 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueInt168 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueInt176 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueInt184 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueInt192 v)) = SolidityNum $ toInteger v

valueToSolidityValue2 (SimpleValue (ValueInt200 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueInt208 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueInt216 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueInt224 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueInt232 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueInt240 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueInt248 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueInt256 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueInt v)) = SolidityNum $ toInteger v

valueToSolidityValue2 (SimpleValue (ValueUInt8 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueUInt16 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueUInt24 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueUInt32 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueUInt40 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueUInt48 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueUInt56 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueUInt64 v)) = SolidityNum $ toInteger v

valueToSolidityValue2 (SimpleValue (ValueUInt72 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueUInt80 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueUInt88 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueUInt96 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueUInt104 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueUInt112 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueUInt120 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueUInt128 v)) = SolidityNum $ toInteger v

valueToSolidityValue2 (SimpleValue (ValueUInt136 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueUInt144 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueUInt152 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueUInt160 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueUInt168 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueUInt176 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueUInt184 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueUInt192 v)) = SolidityNum $ toInteger v

valueToSolidityValue2 (SimpleValue (ValueUInt200 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueUInt208 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueUInt216 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueUInt224 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueUInt232 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueUInt240 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueUInt248 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueUInt256 v)) = SolidityNum $ toInteger v
valueToSolidityValue2 (SimpleValue (ValueUInt v)) = SolidityNum $ toInteger v




valueToSolidityValue2 (SimpleValue (ValueString s)) = SolidityValueAsString2 s
valueToSolidityValue2 (SimpleValue (ValueAddress (Address addr))) =
  SolidityValueAsString2 $ Text.pack $ printf "%040x" (fromIntegral addr::Integer)
valueToSolidityValue2 (ValueContract (Address addr)) =
  SolidityValueAsString2 $ Text.pack $ printf "%040x" (fromIntegral addr::Integer)
valueToSolidityValue2 (ValueArrayFixed _ values) = SolidityArray2 $ map valueToSolidityValue2 values
valueToSolidityValue2 (ValueArrayDynamic values) = SolidityArray2 $ map valueToSolidityValue2 values
valueToSolidityValue2 (SimpleValue (ValueBytes bytes)) = SolidityValueAsString2 $ Text.pack $ BC.unpack bytes
valueToSolidityValue2 (SimpleValue (ValueBytes1 byte)) = SolidityValueAsString2 $ Text.pack $ BC.unpack $ B.pack [byte]
valueToSolidityValue2 (SimpleValue (ValueBytes2 bytes)) = SolidityValueAsString2 $ Text.pack $ BC.unpack bytes
valueToSolidityValue2 (SimpleValue (ValueBytes3 bytes)) = SolidityValueAsString2 $ Text.pack $ BC.unpack bytes
valueToSolidityValue2 (SimpleValue (ValueBytes4 bytes)) = SolidityValueAsString2 $ Text.pack $ BC.unpack bytes
valueToSolidityValue2 (SimpleValue (ValueBytes5 bytes)) = SolidityValueAsString2 $ Text.pack $ BC.unpack bytes
valueToSolidityValue2 (SimpleValue (ValueBytes6 bytes)) = SolidityValueAsString2 $ Text.pack $ BC.unpack bytes
valueToSolidityValue2 (SimpleValue (ValueBytes7 bytes)) = SolidityValueAsString2 $ Text.pack $ BC.unpack bytes
valueToSolidityValue2 (SimpleValue (ValueBytes8 bytes)) = SolidityValueAsString2 $ Text.pack $ BC.unpack bytes
valueToSolidityValue2 (SimpleValue (ValueBytes9 bytes)) = SolidityValueAsString2 $ Text.pack $ BC.unpack bytes
valueToSolidityValue2 (SimpleValue (ValueBytes10 bytes)) = SolidityValueAsString2 $ Text.pack $ BC.unpack bytes
valueToSolidityValue2 (SimpleValue (ValueBytes11 bytes)) = SolidityValueAsString2 $ Text.pack $ BC.unpack bytes
valueToSolidityValue2 (SimpleValue (ValueBytes12 bytes)) = SolidityValueAsString2 $ Text.pack $ BC.unpack bytes
valueToSolidityValue2 (SimpleValue (ValueBytes13 bytes)) = SolidityValueAsString2 $ Text.pack $ BC.unpack bytes
valueToSolidityValue2 (SimpleValue (ValueBytes14 bytes)) = SolidityValueAsString2 $ Text.pack $ BC.unpack bytes
valueToSolidityValue2 (SimpleValue (ValueBytes15 bytes)) = SolidityValueAsString2 $ Text.pack $ BC.unpack bytes
valueToSolidityValue2 (SimpleValue (ValueBytes16 bytes)) = SolidityValueAsString2 $ Text.pack $ BC.unpack bytes
valueToSolidityValue2 (SimpleValue (ValueBytes17 bytes)) = SolidityValueAsString2 $ Text.pack $ BC.unpack bytes
valueToSolidityValue2 (SimpleValue (ValueBytes18 bytes)) = SolidityValueAsString2 $ Text.pack $ BC.unpack bytes
valueToSolidityValue2 (SimpleValue (ValueBytes19 bytes)) = SolidityValueAsString2 $ Text.pack $ BC.unpack bytes
valueToSolidityValue2 (SimpleValue (ValueBytes20 bytes)) = SolidityValueAsString2 $ Text.pack $ BC.unpack bytes
valueToSolidityValue2 (SimpleValue (ValueBytes21 bytes)) = SolidityValueAsString2 $ Text.pack $ BC.unpack bytes
valueToSolidityValue2 (SimpleValue (ValueBytes22 bytes)) = SolidityValueAsString2 $ Text.pack $ BC.unpack bytes
valueToSolidityValue2 (SimpleValue (ValueBytes23 bytes)) = SolidityValueAsString2 $ Text.pack $ BC.unpack bytes
valueToSolidityValue2 (SimpleValue (ValueBytes24 bytes)) = SolidityValueAsString2 $ Text.pack $ BC.unpack bytes
valueToSolidityValue2 (SimpleValue (ValueBytes25 bytes)) = SolidityValueAsString2 $ Text.pack $ BC.unpack bytes
valueToSolidityValue2 (SimpleValue (ValueBytes26 bytes)) = SolidityValueAsString2 $ Text.pack $ BC.unpack bytes
valueToSolidityValue2 (SimpleValue (ValueBytes27 bytes)) = SolidityValueAsString2 $ Text.pack $ BC.unpack bytes
valueToSolidityValue2 (SimpleValue (ValueBytes28 bytes)) = SolidityValueAsString2 $ Text.pack $ BC.unpack bytes
valueToSolidityValue2 (SimpleValue (ValueBytes29 bytes)) = SolidityValueAsString2 $ Text.pack $ BC.unpack bytes
valueToSolidityValue2 (SimpleValue (ValueBytes30 bytes)) = SolidityValueAsString2 $ Text.pack $ BC.unpack bytes
valueToSolidityValue2 (SimpleValue (ValueBytes31 bytes)) = SolidityValueAsString2 $ Text.pack $ BC.unpack bytes
valueToSolidityValue2 (SimpleValue (ValueBytes32 bytes)) = SolidityValueAsString2 $ Text.pack $ BC.unpack bytes
valueToSolidityValue2 (ValueEnum _ _ index)              = SolidityValueAsString2 $ Text.pack $ show index
valueToSolidityValue2 (ValueStruct namedItems) =
  SolidityObject2 $ map (fmap valueToSolidityValue2) namedItems
valueToSolidityValue2 (ValueFunction _ paramTypes returnTypes) =
  SolidityValueAsString2 $ Text.pack $ "function ("
                          ++ intercalate "," (map (formatType . snd) paramTypes)
                          ++ ") returns ("
                          ++ intercalate "," (map (formatType . snd) returnTypes)
                          ++ ")"
