{-# LANGUAGE FlexibleInstances #-}
{-# OPTIONS_GHC -fno-warn-missing-signatures #-}

-- |
-- Module: Selector
-- Description: Source for the calculator for the 4-byte function hash
-- Maintainer: Ryan Reich <ryan@blockapps.net
module BlockApps.Solidity.Parse.Selector (deriveSelector) where

import BlockApps.Solidity.Type
import Crypto.Hash
import qualified Data.ByteArray as ByteArray
import Data.ByteString (ByteString)
import qualified Data.ByteString as ByteString
import Data.List
import Data.Text (Text)
import qualified Data.Text as Text
import Data.Text.Encoding

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
    hash4 bs = ByteString.take 4 . ByteArray.convert $ (hash bs :: Digest Keccak_256)

signature :: [(Text, Int)] -> Text -> [Type] -> ByteString
signature enumSizes name args = encodeUtf8 $ Text.pack $ Text.unpack name ++ prettyArgTypes enumSizes args

prettyArgTypes :: [(Text, Int)] -> [Type] -> String
prettyArgTypes enumSizes args =
  (\x -> "(" ++ x ++ ")") $
    intercalate "," $
      map (formatArg enumSizes) args

formatArg :: [(Text, Int)] -> Type -> String
formatArg _ (SimpleType (TypeInt True Nothing)) = "int256"
formatArg _ (SimpleType (TypeInt False Nothing)) = "uint256"
formatArg _ (SimpleType (TypeInt s (Just b))) = (if s then "int" else "uint") ++ (show $ 8 * b)
formatArg _ (SimpleType (TypeBytes Nothing)) = "bytes"
formatArg _ (SimpleType (TypeBytes (Just b))) = "bytes" ++ show b
formatArg _ (SimpleType TypeBool) = "bool"
formatArg _ (SimpleType TypeAddress) = "address"
formatArg _ (SimpleType TypeAccount) = "account"
formatArg _ (SimpleType TypeString) = "string"
formatArg _ (TypeContract name) = Text.unpack name
formatArg enumSizes (TypeArrayFixed size x) = formatArg enumSizes x ++ "[" ++ show size ++ "]"
formatArg enumSizes (TypeArrayDynamic x) = formatArg enumSizes x ++ "[]"
formatArg enumSizes (TypeMapping x y) = "mapping(" ++ formatArg enumSizes (SimpleType x) ++ "=>" ++ formatArg enumSizes y ++ ")"
formatArg enumSizes (TypeEnum label) =
  case lookup label enumSizes of
    Nothing -> error "you are using an enum not defined"
    Just x | x < 256 -> formatArg enumSizes (SimpleType $ TypeInt False $ Just 1)
    Just x -> error $ "undefined case in formatArg for enum with more than 255 items: size=" ++ show x
formatArg _ (TypeStruct n) = "struct " ++ Text.unpack n
formatArg _ x = error $ "undefined value in formatArg: " ++ show x
