{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Solidity.ABI.Selector
  ( svmTypeToCanonical,
    svmTypeToCanonicalWithContract,
    computeSelector,
    computeSelectorWithContract,
    matchFunction,
    matchFunctionWithContract,
    funcArgTypes,
    funcRetTypes,
  )
where

import Blockchain.Strato.Model.Keccak256 (hash, keccak256ToByteString)
import Control.Lens ((^.))
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import Data.List (intercalate, sortOn)
import qualified Data.Map as M
import qualified Data.Text as T
import qualified SolidVM.Model.CodeCollection as CC
import SolidVM.Model.CodeCollection.VarDef (IndexedType (..))
import SolidVM.Model.SolidString (SolidString, labelToText)
import qualified SolidVM.Model.Type as SVMType

--------------------------------------------------------------------------------
-- SolidVM Type -> canonical Solidity type string
--------------------------------------------------------------------------------

svmTypeToCanonical :: SVMType.Type -> String
svmTypeToCanonical (SVMType.Int (Just True) (Just b)) = "int" ++ show (b * 8)
svmTypeToCanonical (SVMType.Int (Just True) Nothing) = "int256"
svmTypeToCanonical (SVMType.Int _ (Just b)) = "uint" ++ show (b * 8)
svmTypeToCanonical (SVMType.Int _ Nothing) = "uint256"
svmTypeToCanonical SVMType.Bool = "bool"
svmTypeToCanonical (SVMType.Address _) = "address"
svmTypeToCanonical (SVMType.String _) = "string"
svmTypeToCanonical (SVMType.Bytes _ Nothing) = "bytes"
svmTypeToCanonical (SVMType.Bytes _ (Just n)) = "bytes" ++ show n
svmTypeToCanonical (SVMType.Array entry Nothing) = svmTypeToCanonical entry ++ "[]"
svmTypeToCanonical (SVMType.Array entry (Just n)) = svmTypeToCanonical entry ++ "[" ++ show n ++ "]"
svmTypeToCanonical (SVMType.Contract _) = "address"
svmTypeToCanonical (SVMType.Enum (Just b) _ _) = "uint" ++ show (b * 8)
svmTypeToCanonical (SVMType.Enum Nothing _ _) = "uint8"
svmTypeToCanonical (SVMType.UserDefined _ actual) = svmTypeToCanonical actual
svmTypeToCanonical _ = "uint256"

-- | Canonical ABI spelling with access to the defining contract. Solidity
-- hashes a struct parameter as a tuple of its member types; using the old
-- fallback @uint256@ made every Across V3/V4 relay selector incompatible with
-- ordinary Ethereum tooling.
svmTypeToCanonicalWithContract :: CC.Contract -> SVMType.Type -> String
svmTypeToCanonicalWithContract contract typ = case typ of
  SVMType.Struct _ name -> structCanonical name
  SVMType.UnknownLabel name ->
    if M.member name (contract ^. CC.structs)
      then structCanonical name
      else if M.member name (contract ^. CC.enums) then "uint8" else svmTypeToCanonical typ
  SVMType.Array entry Nothing -> svmTypeToCanonicalWithContract contract entry ++ "[]"
  SVMType.Array entry (Just n) -> svmTypeToCanonicalWithContract contract entry ++ "[" ++ show n ++ "]"
  SVMType.UserDefined _ actual -> svmTypeToCanonicalWithContract contract actual
  _ -> svmTypeToCanonical typ
  where
    structCanonical name = case M.lookup name (contract ^. CC.structs) of
      Nothing -> "uint256"
      Just fields ->
        "(" ++ intercalate "," [svmTypeToCanonicalWithContract contract $ CC.fieldTypeType fieldType | (_, fieldType, _) <- fields] ++ ")"

--------------------------------------------------------------------------------
-- Func helpers
--------------------------------------------------------------------------------

funcArgTypes :: CC.Func -> [SVMType.Type]
funcArgTypes f = map (indexedTypeType . snd) $ sortOn (indexedTypeIndex . snd) (CC._funcArgs f)

funcRetTypes :: CC.Func -> [SVMType.Type]
funcRetTypes f = map (indexedTypeType . snd) $ sortOn (indexedTypeIndex . snd) (CC._funcVals f)

--------------------------------------------------------------------------------
-- Selector computation and matching
--------------------------------------------------------------------------------

computeSelector :: SolidString -> [SVMType.Type] -> B.ByteString
computeSelector funcName argTypes =
  let sig = T.unpack (labelToText funcName) ++ "(" ++ intercalate "," (map svmTypeToCanonical argTypes) ++ ")"
   in B.take 4 $ keccak256ToByteString $ hash $ BC.pack sig

computeSelectorWithContract :: CC.Contract -> SolidString -> [SVMType.Type] -> B.ByteString
computeSelectorWithContract contract funcName argTypes =
  let sig = T.unpack (labelToText funcName) ++ "(" ++ intercalate "," (map (svmTypeToCanonicalWithContract contract) argTypes) ++ ")"
   in B.take 4 $ keccak256ToByteString $ hash $ BC.pack sig

matchFunction :: [(T.Text, Int)] -> B.ByteString -> [(SolidString, CC.Func)] -> Maybe (SolidString, CC.Func)
matchFunction _enumSizes selector = go
  where
    go [] = Nothing
    go ((name, func) : rest) =
      let computed = computeSelector name (funcArgTypes func)
       in if computed == selector then Just (name, func) else go rest

matchFunctionWithContract :: CC.Contract -> B.ByteString -> [(SolidString, CC.Func)] -> Maybe (SolidString, CC.Func)
matchFunctionWithContract contract selector = go
  where
    go [] = Nothing
    go ((name, func) : rest) =
      let computed = computeSelectorWithContract contract name (funcArgTypes func)
       in if computed == selector then Just (name, func) else go rest
