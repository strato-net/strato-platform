{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TypeOperators #-}

--TODO : Take this next line out
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Data.AddressStateDB (
  AddressState(..),
  CodePtr(..),
  blankAddressState,
  resolveCodePtr,
  unsafeResolveCodePtr,
  codePtrToSHA,
  resolvedCodePtrToSHA,
  codePtrToCodeKind,
  unsafeCodePtrToCodeKind
) where

import           Prelude hiding (lookup)
import           Control.Lens                       ((^.))
import           Control.Monad
import           Control.Monad.FT
import           Data.Default
import           Data.Maybe                         (maybeToList)

import           Control.DeepSeq
import           GHC.Generics
import           Numeric
import           Text.PrettyPrint.ANSI.Leijen       hiding ((<$>))

import           Blockchain.Data.ChainInfo          (ParentChainId, isAncestorChainOf)
import           Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia as MP
import           Blockchain.ExtWord
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.Strato.Model.CodePtr
import           Blockchain.Util
import qualified Text.Colors                      as CL
import           Text.Format

data AddressState =
  AddressState{
    addressStateNonce::Integer,
    addressStateBalance::Integer,
    addressStateContractRoot::MP.StateRoot,
    addressStateCodeHash::CodePtr,
    addressStateChainId::Maybe Word256
    } deriving (Eq, Generic, Read, Show)

instance NFData AddressState

blankAddressState:: AddressState
blankAddressState = AddressState { addressStateNonce=0, addressStateBalance=0, addressStateContractRoot=MP.emptyTriePtr, addressStateCodeHash=EVMCode $ hash "" , addressStateChainId = Nothing}

instance Default AddressState where
  def = blankAddressState

instance Format AddressState where
  format a =
    CL.blue "AddressState" ++
    tab("\nnonce: " ++ showHex (addressStateNonce a) "" ++
        "\nbalance: " ++ show (toInteger $ addressStateBalance a) ++
        "\ncontractRoot: " ++ format (addressStateContractRoot a) ++
        "\ncodeHash: " ++ format (addressStateCodeHash a) ++
        "\nchainId: " ++ (show $ fmap (flip showHex "") (addressStateChainId a)))

instance RLPSerializable AddressState where
  rlpEncode a | addressStateBalance a < 0 = error $ "Error in cal to rlpEncode for AddressState: AddressState has negative balance: " ++ format a
  rlpEncode a = RLPArray $ [
    rlpEncode $ toInteger $ addressStateNonce a,
    rlpEncode $ toInteger $ addressStateBalance a,
    rlpEncode $ addressStateContractRoot a,
    rlpEncode $ addressStateCodeHash a
    ] ++ (maybeToList . fmap rlpEncode $ addressStateChainId a)

  rlpDecode (RLPArray [n, b, cr, ch, cid]) =
    AddressState {
      addressStateNonce=fromInteger $ rlpDecode n,
      addressStateBalance=fromInteger $ rlpDecode b,
      addressStateContractRoot=rlpDecode cr,
      addressStateCodeHash=rlpDecode ch,
      addressStateChainId = Just $ rlpDecode cid
      }
  rlpDecode (RLPArray [n, b, cr, ch]) =
    AddressState {
      addressStateNonce=fromInteger $ rlpDecode n,
      addressStateBalance=fromInteger $ rlpDecode b,
      addressStateContractRoot=rlpDecode cr,
      addressStateCodeHash=rlpDecode ch,
      addressStateChainId = Nothing
      }
  rlpDecode x = error $ "Missing case in rlpDecode for AddressState: " ++ show (pretty x)
{-- TODO: 
    resolveCodePtr fails when there is a circular reference of code pointers on the same chain
    possible solution is to have a helper function that keeps track of all previously visited codepointers and termiantes if it visits the same one twice (aka cycle detection)
--}
resolveCodePtr :: ( (Maybe Word256 `Selects` ParentChainId) m
                  , (Account `Selects` AddressState) m
                  )
               => Maybe Word256 -> CodePtr -> m (Maybe CodePtr)
resolveCodePtr chainId (CodeAtAccount acct name) = do
  select acct >>= \case
    Nothing -> pure Nothing
    Just AddressState{..} -> do
      let codeAccountChainId = (acct ^. accountChainId)
      isAccessibleChain <- codeAccountChainId `isAncestorChainOf` chainId
      if isAccessibleChain
        then resolveCodePtr codeAccountChainId addressStateCodeHash >>= \case
          Just e@(EVMCode _) -> pure $ Just e
          Just (SolidVMCode _ d) -> pure . Just $ SolidVMCode name d
          _ -> pure Nothing
        else pure Nothing

-- for solidVM/EVM code
resolveCodePtr _ cp = pure $ Just cp

unsafeResolveCodePtr :: (Account `Selects` AddressState) m => CodePtr -> m (Maybe CodePtr)
unsafeResolveCodePtr (CodeAtAccount acct name) = select acct >>= \case
  Nothing -> pure Nothing
  Just AddressState{..} -> unsafeResolveCodePtr addressStateCodeHash >>= \case
    Just e@(EVMCode _) -> pure $ Just e
    Just (SolidVMCode _ d) -> pure . Just $ SolidVMCode name d
    _ -> pure Nothing
unsafeResolveCodePtr codePtr = pure $ Just codePtr

codePtrToSHA :: ( (Maybe Word256 `Selects` ParentChainId) m
                , (Account `Selects` AddressState) m
                )
             => Maybe Word256 -> CodePtr -> m (Maybe Keccak256)
codePtrToSHA chainId = resolveCodePtr chainId >=> \case
  Just (EVMCode hsh) -> pure $ Just hsh
  Just (SolidVMCode _ hsh) -> pure $ Just hsh
  _ -> pure Nothing -- CodeAtAccount cannot happen here

resolvedCodePtrToSHA :: CodePtr -> Keccak256
resolvedCodePtrToSHA (EVMCode hsh) = hsh
resolvedCodePtrToSHA (SolidVMCode _ hsh) = hsh
resolvedCodePtrToSHA _ = emptyHash

codePtrToCodeKind :: ( (Maybe Word256 `Selects` ParentChainId) m
                     , (Account `Selects` AddressState) m
                     )
                  => Maybe Word256 -> CodePtr -> m CodeKind
codePtrToCodeKind chainId = resolveCodePtr chainId >=> \case
  Just (SolidVMCode _ _) -> pure SolidVM
  _ -> pure EVM -- TODO: should this return (Maybe CodeKind)?

unsafeCodePtrToCodeKind :: (Account `Selects` AddressState) m => CodePtr -> m CodeKind
unsafeCodePtrToCodeKind = unsafeResolveCodePtr >=> \case
  Just (SolidVMCode _ _) -> pure SolidVM
  _ -> pure EVM -- TODO: should this return (Maybe CodeKind)?
