module BlockApps.Solidity.Type where

import Data.ByteString (ByteString)
import Data.Char
import Data.List
import Data.Text (Text)
import qualified Data.Text as T


data Type
  = SimpleType SimpleType
  | TypeArrayDynamic Type
  | TypeArrayFixed Word Type
  | TypeMapping SimpleType Type
  | TypeFunction ByteString [(Text, Type)] [(Maybe Text, Type)]
  | TypeStruct Text
  | TypeEnum Text
  | TypeContract Text
  deriving (Show)
    
data SimpleType
  = TypeBool
  | TypeUInt8
  | TypeUInt16
  | TypeUInt24
  | TypeUInt32
  | TypeUInt40
  | TypeUInt48
  | TypeUInt56
  | TypeUInt64
  | TypeUInt72
  | TypeUInt80
  | TypeUInt88
  | TypeUInt96
  | TypeUInt104
  | TypeUInt112
  | TypeUInt120
  | TypeUInt128
  | TypeUInt136
  | TypeUInt144
  | TypeUInt152
  | TypeUInt160
  | TypeUInt168
  | TypeUInt176
  | TypeUInt184
  | TypeUInt192
  | TypeUInt200
  | TypeUInt208
  | TypeUInt216
  | TypeUInt224
  | TypeUInt232
  | TypeUInt240
  | TypeUInt248
  | TypeUInt256
  | TypeUInt
  | TypeInt8
  | TypeInt16
  | TypeInt24
  | TypeInt32
  | TypeInt40
  | TypeInt48
  | TypeInt56
  | TypeInt64
  | TypeInt72
  | TypeInt80
  | TypeInt88
  | TypeInt96
  | TypeInt104
  | TypeInt112
  | TypeInt120
  | TypeInt128
  | TypeInt136
  | TypeInt144
  | TypeInt152
  | TypeInt160
  | TypeInt168
  | TypeInt176
  | TypeInt184
  | TypeInt192
  | TypeInt200
  | TypeInt208
  | TypeInt216
  | TypeInt224
  | TypeInt232
  | TypeInt240
  | TypeInt248
  | TypeInt256
  | TypeInt
  | TypeAddress
  -- | TypeFixed
  -- | TypeUFixed
  | TypeBytes1
  | TypeBytes2
  | TypeBytes3
  | TypeBytes4
  | TypeBytes5
  | TypeBytes6
  | TypeBytes7
  | TypeBytes8
  | TypeBytes9
  | TypeBytes10
  | TypeBytes11
  | TypeBytes12
  | TypeBytes13
  | TypeBytes14
  | TypeBytes15
  | TypeBytes16
  | TypeBytes17
  | TypeBytes18
  | TypeBytes19
  | TypeBytes20
  | TypeBytes21
  | TypeBytes22
  | TypeBytes23
  | TypeBytes24
  | TypeBytes25
  | TypeBytes26
  | TypeBytes27
  | TypeBytes28
  | TypeBytes29
  | TypeBytes30
  | TypeBytes31
  | TypeBytes32
  | TypeBytes
  | TypeString
  deriving (Show)

formatSimpleType::SimpleType->String
formatSimpleType x = map toLower $ drop 4 $ show x

formatType::Type->String
formatType (SimpleType x) = formatSimpleType x
--formatType x = show x
formatType (TypeArrayDynamic t) = formatType t ++ "[] " --TODO- might need some parens
formatType (TypeArrayFixed len t) = formatType t ++ "[" ++ show len ++ "] " --TODO- might need some parens
formatType (TypeMapping key val) = "mapping (" ++ formatSimpleType key ++ " => " ++ formatType val ++ ")"
formatType (TypeFunction _ paramTypes returnTypes) =
  "function ("
  ++ intercalate "," (map (formatType . snd) paramTypes)
  ++ ") returns ("
  ++ intercalate "," (map (formatType . snd) returnTypes)
  ++ ")"
formatType (TypeEnum name) = T.unpack name
formatType (TypeContract name) = T.unpack name
formatType (TypeStruct name) = T.unpack name

                                 
