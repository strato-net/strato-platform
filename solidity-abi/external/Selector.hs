{-# LANGUAGE FlexibleInstances #-}
{-# OPTIONS_GHC -fno-warn-missing-signatures #-}
module Selector (selector) where

import qualified Data.ByteString as BS
import Data.ByteString (ByteString)

import Data.Maybe
import qualified Data.Text as T
import Data.Text.Encoding
import Text.PrettyPrint

import qualified Crypto.Hash.SHA3 as SHA3 (hash)
import Numeric

import ParserTypes

selector :: Identifier -> [SolidityObjDef] -> [SolidityObjDef] -> String
selector name args vals = hash4 $ signature name args vals
  where
    hash4 bs = concatMap toHex $ BS.unpack $ BS.take 4 $ SHA3.hash 256 bs
    toHex = zeroPad . flip showHex ""
    zeroPad [c] = ['0',c]
    zeroPad x = x

signature :: Identifier -> [SolidityObjDef] -> [SolidityObjDef] -> ByteString
signature name args _ = encodeUtf8 $ T.pack $ name ++ prettyArgTypes args

prettyArgTypes :: [SolidityObjDef] -> String
prettyArgTypes args =
  show $ parens $ hcat $ punctuate (text ",") $
  catMaybes $ map (fmap pretty . varType) args

varType :: SolidityObjDef -> Maybe SolidityBasicType
varType (ObjDef _ (SingleValue t) NoValue _) = Just t
varType _ = Nothing

pretty :: SolidityBasicType -> Doc
pretty Boolean = text "bool"
pretty Address = text "address"
pretty (SignedInt s) = text "int" <> natural (s * 8)
pretty (UnsignedInt s) = text "uint" <> natural (s * 8)
pretty (FixedBytes s) = text "bytes" <> natural s
pretty DynamicBytes = text "bytes"
pretty String = text "string"
pretty (FixedArray t l) = (pretty t) <> text "[" <> natural l <> text "]"
pretty (DynamicArray t) = (pretty t) <> text "[]"
pretty (Mapping d c) =
  text "mapping" <+> (parens $ pretty d <+> text "=>" <+> pretty c)
pretty (Typedef name) = text name

natural = integer . toInteger
