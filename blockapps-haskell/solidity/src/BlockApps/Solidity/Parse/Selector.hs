-- |
-- Module: Selector
-- Description: Source for the calculator for the 4-byte function hash
-- Maintainer: Ryan Reich <ryan@blockapps.net
{-# LANGUAGE FlexibleInstances #-}
{-# OPTIONS_GHC -fno-warn-missing-signatures #-}
module BlockApps.Solidity.Parse.Selector (deriveSelector) where
import           Crypto.Hash
import qualified Data.ByteArray          as ByteArray
import           Data.ByteString         (ByteString)
import qualified Data.ByteString         as ByteString
import           Data.List
import           Data.Text               (Text)
import qualified Data.Text               as Text
import           Data.Text.Encoding

import           BlockApps.Solidity.Type

-- | The 'selector' function is responsible for producing the 4-byte
-- hash that Solidity uses to identify functions.  It's essentially the
-- first 4 bytes of the Keccak hash of the signature with all the argument
-- names, modifiers, and storage specifiers removed.  If the signature
-- contains 'enum' or contract type names, however, they are converted to,
-- respectively 'uintX' and 'address' types, where X is the least number of
-- bytes (in bits) that can hold all the enum's values.  Structs are not
-- permitted at all.
deriveSelector :: [(Text, Int)] -> Text -> [Type] -> ByteString
deriveSelector enumSizes name args = hash4 $ signature enumSizes name args
  where
    hash4 bs = ByteString.take 4 . ByteArray.convert $ (hash bs::Digest Keccak_256)

signature :: [(Text, Int)] -> Text -> [Type] -> ByteString
signature enumSizes name args = encodeUtf8 $ Text.pack $ Text.unpack name ++ prettyArgTypes enumSizes args

prettyArgTypes :: [(Text, Int)] -> [Type] -> String
prettyArgTypes enumSizes args =
  (\x -> "(" ++ x ++ ")") $ intercalate "," $
  map (formatArg enumSizes) args

formatArg :: [(Text, Int)] -> Type -> String
formatArg _ (SimpleType (TypeInt True Nothing)) = "int256"
formatArg _ (SimpleType (TypeInt False Nothing)) = "uint256"
formatArg _ (SimpleType (TypeInt s (Just b))) = (if s then "int" else "uint") ++ (show $ 8 * b)
formatArg _ (SimpleType (TypeBytes Nothing)) = "bytes"
formatArg _ (SimpleType (TypeBytes (Just b))) = "bytes" ++ show b
formatArg _ (SimpleType TypeBool) = "bool"
formatArg _ (SimpleType TypeAddress) = "address"
formatArg _ (SimpleType TypeString) = "string"
formatArg enumSizes (TypeArrayFixed size x) = formatArg enumSizes x ++"[" ++ show size ++ "]"
formatArg enumSizes (TypeArrayDynamic x) = formatArg enumSizes x ++"[]"
formatArg enumSizes (TypeMapping x y) = "mapping(" ++ formatArg enumSizes (SimpleType x) ++ "=>" ++ formatArg enumSizes y ++ ")"
formatArg enumSizes (TypeEnum label) =
  case lookup label enumSizes of
   Nothing -> error "you are using an enum not defined"
   Just x | x < 256 -> formatArg enumSizes (SimpleType $ TypeInt False $ Just 1)
   Just x -> error $ "undefined case in formatArg for enum with more than 255 items: size=" ++ show x

formatArg _ x = error $ "undefined value in formatArg: " ++ show x










{-formatArg _ (SignedInt s) = text "int" <> natural (s * 8)
formatArg _ (UnsignedInt s) = text "uint" <> natural (s * 8)
formatArg _ (FixedBytes s) = text "bytes" <> natural s
formatArg _ DynamicBytes = text "bytes"
formatArg _ String = text "string"
formatArg typesL (FixedArray t l) = pretty typesL t <> text "[" <> natural l <> text "]"
formatArg typesL (DynamicArray t) = pretty typesL t <> text "[]"
formatArg typesL (Mapping d c) =
  text "mapping" <+> parens (pretty typesL d <+> text "=>" <+> pretty typesL c)
formatArg typesL (Typedef name) =
  case typesL Map.! name of
    EnumLayout s -> pretty typesL (UnsignedInt s)
    _ -> text name -}

{-

selector :: SolidityTypesLayout -> Identifier -> [SolidityObjDef] -> [SolidityObjDef] -> String
selector typesL name args vals = hash4 $ signature typesL name args vals
  where
    hash4 bs = concatMap toHex $ BS.unpack $ BS.take 4 $ SHA3.hash 256 bs
    toHex = zeroPad . flip showHex ""
    zeroPad [c] = ['0',c]
    zeroPad x = x

signature :: SolidityTypesLayout -> Identifier -> [SolidityObjDef] -> [SolidityObjDef] -> ByteString
signature typesL name args _ = encodeUtf8 $ T.pack $ name ++ prettyArgTypes typesL args

prettyArgTypes :: SolidityTypesLayout -> [SolidityObjDef] -> String
prettyArgTypes typesL args =
  show $ parens $ hcat $ punctuate (text ",") $
  mapMaybe (fmap (pretty typesL) . varType) args

varType :: SolidityObjDef -> Maybe SolidityBasicType
varType (ObjDef _ (SingleValue t) NoValue _ _) = Just t
varType _ = Nothing

pretty :: SolidityTypesLayout -> SolidityBasicType -> Doc
pretty _ Boolean = text "bool"
{-pretty _ Address = text "address"
pretty _ (SignedInt s) = text "int" <> natural (s * 8)
pretty _ (UnsignedInt s) = text "uint" <> natural (s * 8)
pretty _ (FixedBytes s) = text "bytes" <> natural s
pretty _ DynamicBytes = text "bytes"
pretty _ String = text "string"
pretty typesL (FixedArray t l) = pretty typesL t <> text "[" <> natural l <> text "]"
pretty typesL (DynamicArray t) = pretty typesL t <> text "[]"
pretty typesL (Mapping d c) =
  text "mapping" <+> parens (pretty typesL d <+> text "=>" <+> pretty typesL c)
pretty typesL (Typedef name) =
  case typesL Map.! name of
    EnumLayout s -> pretty typesL (UnsignedInt s)
    _ -> text name -}

natural = integer . toInteger


-}
