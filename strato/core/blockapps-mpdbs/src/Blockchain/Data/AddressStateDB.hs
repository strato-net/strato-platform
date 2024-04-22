{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE IncoherentInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE TypeSynonymInstances #-}
--TODO : Take this next line out
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Data.AddressStateDB
  ( AddressState (..),
    MainChainT (..),
    CodePtr (..),
    blankAddressState,
    resolveCodePtr,
    unsafeResolveCodePtr,
    resolveCodePtrParent,
    codePtrToSHA,
    resolvedCodePtrToSHA,
    codePtrToCodeKind,
    unsafeCodePtrToCodeKind,
    getAppAccount,
  )
where

import Blockchain.Data.ChainInfo (ParentChainIds, isAncestorChainOf)
import Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.CodePtr
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Control.DeepSeq
import Control.Lens ((^.))
import Control.Monad
import Control.Monad.Change.Alter
import Control.Monad.IO.Class
import Control.Monad.Trans.Class
import Control.Monad.IO.Unlift
import Control.Monad.Logger
import Data.Default
import Data.Maybe (maybeToList)
import qualified Data.Set as Set
import GHC.Generics
import Numeric
import qualified Text.Colors as CL
import Text.Format
import Text.Tools
import Prelude hiding (lookup)


data AddressState = AddressState
  { addressStateNonce :: Integer,
    addressStateBalance :: Integer,
    addressStateContractRoot :: MP.StateRoot,
    addressStateCodeHash :: CodePtr,
    addressStateChainId :: Maybe Word256
  }
  deriving (Eq, Generic, Read, Show)

instance NFData AddressState

newtype MainChainT m a = MainChainT {runMainChainT :: m a}
  deriving (Eq, Show, Functor, Applicative, Monad, MonadIO)

instance MonadTrans MainChainT where
  lift = MainChainT

instance (Account `Alters` AddressState) m => (Account `Alters` AddressState) (MainChainT m) where
  lookup p = lift . lookup p
  insert p k = lift . insert p k
  delete p = lift . delete p

instance Selectable Account AddressState m => Selectable Account AddressState (MainChainT m) where
  select p = lift . select p

instance Monad m => Selectable Word256 ParentChainIds (MainChainT m) where
  select _ _ = pure Nothing

instance MonadUnliftIO m => MonadUnliftIO (MainChainT m) where
  {-# INLINE withRunInIO #-}
  withRunInIO inner =
    MainChainT $
    withRunInIO $ \run ->
    inner (run . runMainChainT)

instance MonadLogger m => MonadLogger  (MainChainT m)

blankAddressState :: AddressState
blankAddressState = AddressState {addressStateNonce = 0, addressStateBalance = 0, addressStateContractRoot = MP.emptyTriePtr, addressStateCodeHash = ExternallyOwned $ hash "", addressStateChainId = Nothing}

instance Default AddressState where
  def = blankAddressState

instance Format AddressState where
  format a =
    CL.blue "AddressState"
      ++ tab'
        ( "\nnonce: " ++ showHex (addressStateNonce a) ""
            ++ "\nbalance: "
            ++ show (toInteger $ addressStateBalance a)
            ++ "\ncontractRoot: "
            ++ format (addressStateContractRoot a)
            ++ "\ncodeHash: "
            ++ format (addressStateCodeHash a)
            ++ "\nchainId: "
            ++ (show $ fmap (flip showHex "") (addressStateChainId a))
        )

instance RLPSerializable AddressState where
  rlpEncode a | addressStateBalance a < 0 = error $ "Error in cal to rlpEncode for AddressState: AddressState has negative balance: " ++ format a
  rlpEncode a =
    RLPArray $
      [ rlpEncode $ toInteger $ addressStateNonce a,
        rlpEncode $ toInteger $ addressStateBalance a,
        rlpEncode $ addressStateContractRoot a,
        rlpEncode $ addressStateCodeHash a
      ]
        ++ (maybeToList . fmap rlpEncode $ addressStateChainId a)

  rlpDecode (RLPArray [n, b, cr, ch, cid]) =
    AddressState
      { addressStateNonce = fromInteger $ rlpDecode n,
        addressStateBalance = fromInteger $ rlpDecode b,
        addressStateContractRoot = rlpDecode cr,
        addressStateCodeHash = rlpDecode ch,
        addressStateChainId = Just $ rlpDecode cid
      }
  rlpDecode (RLPArray [n, b, cr, ch]) =
    AddressState
      { addressStateNonce = fromInteger $ rlpDecode n,
        addressStateBalance = fromInteger $ rlpDecode b,
        addressStateContractRoot = rlpDecode cr,
        addressStateCodeHash = rlpDecode ch,
        addressStateChainId = Nothing
      }
  rlpDecode x = error $ "Missing case in rlpDecode for AddressState: " ++ format x

{-- TODO:
    resolveCodePtr fails when there is a circular reference of code pointers on the same chain
    possible solution is to have a helper function that keeps track of all previously visited codepointers and termiantes if it visits the same one twice (aka cycle detection)
--}
resolveCodePtr' ::
  ( Selectable Word256 ParentChainIds m,
    Selectable Account AddressState m
  ) =>
  Set.Set CodePtr ->
  Maybe Word256 ->
  CodePtr ->
  m (Maybe CodePtr)
resolveCodePtr' visited chainId (CodeAtAccount acct name) = do
  select Proxy acct >>= \case
    Nothing -> pure Nothing
    Just AddressState {..} -> do
      let codeAccountChainId = (acct ^. accountChainId)
      isAccessibleChain <- codeAccountChainId `isAncestorChainOf` chainId
      if isAccessibleChain && (Set.notMember addressStateCodeHash visited)
        then
          resolveCodePtr' (Set.insert addressStateCodeHash visited) codeAccountChainId addressStateCodeHash >>= \case
            Just e@(ExternallyOwned _) -> pure $ Just e
            Just (SolidVMCode _ d) -> pure . Just $ SolidVMCode name d
            _ -> pure Nothing
        else pure Nothing
resolveCodePtr' _ cid cp = resolveCodePtr cid cp

resolveCodePtr ::
  ( Selectable Word256 ParentChainIds m,
    Selectable Account AddressState m
  ) =>
  Maybe Word256 ->
  CodePtr ->
  m (Maybe CodePtr)
resolveCodePtr chainId coa@(CodeAtAccount _ _) = resolveCodePtr' Set.empty chainId coa
-- for solidVM/EVM code
resolveCodePtr _ cp = pure $ Just cp

unsafeResolveCodePtr :: Selectable Account AddressState m => CodePtr -> m (Maybe CodePtr)
unsafeResolveCodePtr (CodeAtAccount acct name) =
  select Proxy acct >>= \case
    Nothing -> pure Nothing
    Just AddressState {..} ->
      unsafeResolveCodePtr addressStateCodeHash >>= \case
        Just e@(ExternallyOwned _) -> pure $ Just e
        Just (SolidVMCode _ d) -> pure . Just $ SolidVMCode name d
        _ -> pure Nothing
unsafeResolveCodePtr codePtr = pure $ Just codePtr

resolveCodePtrParent ::
  ( Selectable Word256 ParentChainIds m,
    Selectable Account AddressState m
  ) =>
  Maybe Word256 ->
  CodePtr ->
  m (Maybe CodePtr)
resolveCodePtrParent chainId cp@(CodeAtAccount acct _) = do
  isAccessibleChain <- (acct ^. accountChainId) `isAncestorChainOf` chainId
  if isAccessibleChain
    then unsafeResolveCodePtrParent cp
    else pure Nothing
resolveCodePtrParent _ cp = unsafeResolveCodePtrParent cp

unsafeResolveCodePtrParent :: Selectable Account AddressState m => CodePtr -> m (Maybe CodePtr)
unsafeResolveCodePtrParent (CodeAtAccount acct _) =
  select Proxy acct >>= \case
    Nothing -> pure Nothing
    Just AddressState {..} ->
      unsafeResolveCodePtrParent addressStateCodeHash >>= \case
        Just e@(ExternallyOwned _) -> pure $ Just e
        Just (SolidVMCode name' d) -> pure . Just $ SolidVMCode name' d
        _ -> pure Nothing
unsafeResolveCodePtrParent codePtr = pure $ Just codePtr

codePtrToSHA ::
  ( Selectable Word256 ParentChainIds m,
    Selectable Account AddressState m
  ) =>
  Maybe Word256 ->
  CodePtr ->
  m (Maybe Keccak256)
codePtrToSHA chainId =
  resolveCodePtr chainId >=> \case
    Just (ExternallyOwned hsh) -> pure $ Just hsh
    Just (SolidVMCode _ hsh) -> pure $ Just hsh
    _ -> pure Nothing -- CodeAtAccount cannot happen here

resolvedCodePtrToSHA :: CodePtr -> Keccak256
resolvedCodePtrToSHA (ExternallyOwned hsh) = hsh
resolvedCodePtrToSHA (SolidVMCode _ hsh) = hsh
resolvedCodePtrToSHA _ = emptyHash

codePtrToCodeKind ::
  ( Selectable Word256 ParentChainIds m,
    Selectable Account AddressState m
  ) =>
  Maybe Word256 ->
  CodePtr ->
  m CodeKind
codePtrToCodeKind chainId =
  resolveCodePtr chainId >=> \case
    Just (SolidVMCode _ _) -> pure SolidVM
    _ -> pure SolidVM -- TODO: should this return (Maybe CodeKind)?

unsafeCodePtrToCodeKind :: Selectable Account AddressState m => CodePtr -> m CodeKind
unsafeCodePtrToCodeKind =
  unsafeResolveCodePtr >=> \case
    Just (SolidVMCode _ _) -> pure SolidVM
    _ -> pure SolidVM -- TODO: should this return (Maybe CodeKind)?

getAppAccount ::
  ( Selectable Word256 ParentChainIds m,
    Selectable Account AddressState m
  ) =>
  Maybe Word256 ->
  Account ->
  m (Maybe Account)
getAppAccount chainId acct = do
  select Proxy acct >>= \case
    Nothing -> pure Nothing
    Just AddressState {..} -> do
      let codeAccountChainId = (acct ^. accountChainId)
      isAccessibleChain <- codeAccountChainId `isAncestorChainOf` chainId
      if isAccessibleChain
        then case addressStateCodeHash of
          (CodeAtAccount pAcct _) -> getAppAccount codeAccountChainId pAcct
          _ -> pure $ Just acct
        else pure Nothing
