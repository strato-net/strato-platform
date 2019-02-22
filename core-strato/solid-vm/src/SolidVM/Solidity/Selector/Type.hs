{-# LANGUAGE OverloadedStrings #-}

module SolidVM.Solidity.Selector.Type where

import           Control.DeepSeq
import           Data.Binary
import           Data.ByteString (ByteString)
import           Data.List
import           Data.Text       (Text)
import qualified Data.Text       as Text
import           GHC.Generics

typeUInt :: SimpleType
typeUInt = TypeInt False Nothing

typeInt :: SimpleType
typeInt = TypeInt True Nothing

typeUInt256 :: SimpleType
typeUInt256 = TypeInt False (Just 32)

typeInt256 :: SimpleType
typeInt256 = TypeInt True (Just 32)

typeBytes :: SimpleType
typeBytes = TypeBytes Nothing

data Type
  = SimpleType SimpleType
  | TypeArrayDynamic Type
  | TypeArrayFixed Word Type
  | TypeMapping SimpleType Type
  | TypeFunction ByteString [(Text, Type)] [(Maybe Text, Type)]
  | TypeStruct Text
  | TypeEnum Text
  | TypeContract Text
  deriving (Eq, Show, Generic, NFData, Binary)

data SimpleType
  = TypeBool
  | TypeAddress
  | TypeString
  | TypeInt { intSigned :: Bool
            , intSize   :: Maybe Integer
            }
  | TypeBytes { bytesSize :: Maybe Integer
              }
  deriving (Eq, Show, Generic, NFData, Binary)

getTypeByteLength :: Type -> Maybe Int
getTypeByteLength = \case
  SimpleType ty         -> getSimpleTypeByteLength ty
  TypeArrayDynamic{}    -> Nothing
  TypeArrayFixed len ty -> (fromIntegral len *) <$> getTypeByteLength ty
  TypeMapping{}         -> Nothing
  TypeFunction{}        -> Nothing
  TypeStruct{}          -> Nothing
  TypeEnum{}            -> Nothing
  TypeContract{}        -> getSimpleTypeByteLength TypeAddress

getSimpleTypeByteLength :: SimpleType -> Maybe Int
getSimpleTypeByteLength = \case
  TypeString -> Nothing
  TypeBytes Nothing -> Nothing
  _ -> Just 32

formatSimpleType::SimpleType->String
formatSimpleType (TypeInt True Nothing) = "int"
formatSimpleType (TypeInt False Nothing) = "uint"
formatSimpleType (TypeInt s (Just b)) = (if s then "" else "u") ++ "int" ++ (show $ 8 * b)
formatSimpleType (TypeBytes Nothing) = "bytes"
formatSimpleType (TypeBytes (Just b)) = "bytes" ++ show b
formatSimpleType TypeBool = "bool"
formatSimpleType TypeAddress = "address"
formatSimpleType TypeString = "string"

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
