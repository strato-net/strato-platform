{-# LANGUAGE
    OverloadedStrings,
    LambdaCase
#-}

module BlockApps.Solidity.Type where

import Data.ByteString (ByteString)
import Data.Char
import Data.List
import Data.Text (Text)
import qualified Data.Text as Text
import Text.Read

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
  deriving (Show,Read)

getTypeByteLength :: Type -> Maybe Int
getTypeByteLength = \case
  SimpleType ty -> getSimpleTypeByteLength ty
  TypeArrayDynamic _ -> Nothing
  TypeArrayFixed len ty -> (fromIntegral len *) <$> (getTypeByteLength ty)
  TypeMapping _ _ -> Nothing
  TypeFunction _ _ _ -> Nothing
  TypeStruct _ -> Nothing
  TypeEnum _ -> Nothing
  TypeContract _ -> getSimpleTypeByteLength TypeAddress

getSimpleTypeByteLength :: SimpleType -> Maybe Int
getSimpleTypeByteLength = \case
  TypeBool -> Just 1
  TypeUInt8 -> Just 1
  TypeUInt16 -> Just 2
  TypeUInt24 -> Just 3
  TypeUInt32 -> Just 4
  TypeUInt40 -> Just 5
  TypeUInt48 -> Just 6
  TypeUInt56 -> Just 7
  TypeUInt64 -> Just 8
  TypeUInt72 -> Just 9
  TypeUInt80 -> Just 10
  TypeUInt88 -> Just 11
  TypeUInt96 -> Just 12
  TypeUInt104 -> Just 13
  TypeUInt112 -> Just 14
  TypeUInt120 -> Just 15
  TypeUInt128 -> Just 16
  TypeUInt136 -> Just 17
  TypeUInt144 -> Just 18
  TypeUInt152 -> Just 19
  TypeUInt160 -> Just 20
  TypeUInt168 -> Just 21
  TypeUInt176 -> Just 22
  TypeUInt184 -> Just 23
  TypeUInt192 -> Just 24
  TypeUInt200 -> Just 25
  TypeUInt208 -> Just 26
  TypeUInt216 -> Just 27
  TypeUInt224 -> Just 28
  TypeUInt232 -> Just 29
  TypeUInt240 -> Just 30
  TypeUInt248 -> Just 31
  TypeUInt256 -> Just 32
  TypeUInt -> Just 32
  TypeInt8 -> Just 1
  TypeInt16 -> Just 2
  TypeInt24 -> Just 3
  TypeInt32 -> Just 4
  TypeInt40 -> Just 5
  TypeInt48 -> Just 6
  TypeInt56 -> Just 7
  TypeInt64 -> Just 8
  TypeInt72 -> Just 9
  TypeInt80 -> Just 10
  TypeInt88 -> Just 11
  TypeInt96 -> Just 12
  TypeInt104 -> Just 13
  TypeInt112 -> Just 14
  TypeInt120 -> Just 15
  TypeInt128 -> Just 16
  TypeInt136 -> Just 17
  TypeInt144 -> Just 18
  TypeInt152 -> Just 19
  TypeInt160 -> Just 20
  TypeInt168 -> Just 21
  TypeInt176 -> Just 22
  TypeInt184 -> Just 23
  TypeInt192 -> Just 24
  TypeInt200 -> Just 25
  TypeInt208 -> Just 26
  TypeInt216 -> Just 27
  TypeInt224 -> Just 28
  TypeInt232 -> Just 29
  TypeInt240 -> Just 30
  TypeInt248 -> Just 31
  TypeInt256 -> Just 32
  TypeInt -> Just 32
  TypeAddress -> Just 20
  -- TypeFixed Just ->
  -- TypeUFixed Just ->
  TypeBytes1 ->Just 1
  TypeBytes2 ->Just 2
  TypeBytes3 ->Just 3
  TypeBytes4 ->Just 4
  TypeBytes5 ->Just 5
  TypeBytes6 ->Just 6
  TypeBytes7 ->Just 7
  TypeBytes8 ->Just 8
  TypeBytes9 ->Just 9
  TypeBytes10 -> Just 10
  TypeBytes11 -> Just 11
  TypeBytes12 -> Just 12
  TypeBytes13 -> Just 13
  TypeBytes14 -> Just 14
  TypeBytes15 -> Just 15
  TypeBytes16 -> Just 16
  TypeBytes17 -> Just 17
  TypeBytes18 -> Just 18
  TypeBytes19 -> Just 19
  TypeBytes20 -> Just 20
  TypeBytes21 -> Just 21
  TypeBytes22 -> Just 22
  TypeBytes23 -> Just 23
  TypeBytes24 -> Just 24
  TypeBytes25 -> Just 25
  TypeBytes26 -> Just 26
  TypeBytes27 -> Just 27
  TypeBytes28 -> Just 28
  TypeBytes29 -> Just 29
  TypeBytes30 -> Just 30
  TypeBytes31 -> Just 31
  TypeBytes32 -> Just 32
  TypeBytes -> Nothing
  TypeString -> Nothing

formatSimpleType::SimpleType->String
formatSimpleType x = drop 4 $ show x

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
formatType (TypeEnum name) = Text.unpack name
formatType (TypeContract name) = Text.unpack name
formatType (TypeStruct name) = Text.unpack name

textToSimpleArgType :: Text -> Maybe SimpleType
textToSimpleArgType str = if Text.null str then Nothing
  else readMaybe ("Type" ++ toUpper (Text.head str) : (Text.unpack (Text.toLower (Text.tail str))))

textToArgType :: Text -> Bool -> Text -> Maybe Type
textToArgType "Array" True str = TypeArrayDynamic . SimpleType <$> textToSimpleArgType str
textToArgType "Array" False str = TypeArrayFixed 0 . SimpleType <$> textToSimpleArgType str
textToArgType str _ _ = SimpleType <$> textToSimpleArgType str
