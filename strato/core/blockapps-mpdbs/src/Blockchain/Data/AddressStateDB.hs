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
    getAppAccount,
  )
where

import Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.CodePtr
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Control.DeepSeq
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

instance (Address `Alters` AddressState) m => (Address `Alters` AddressState) (MainChainT m) where
  lookup p = lift . lookup p
  insert p k = lift . insert p k
  delete p = lift . delete p

instance Selectable Address AddressState m => Selectable Address AddressState (MainChainT m) where
  select p = lift . select p

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
  ( Selectable Address AddressState m
  ) =>
  Set.Set CodePtr ->
  CodePtr ->
  m (Maybe CodePtr)
resolveCodePtr' visited (CodeAtAccount address name) = do
  select Proxy address >>= \case
    Nothing -> pure Nothing
    Just AddressState {..} -> do
      if Set.notMember addressStateCodeHash visited
        then
          resolveCodePtr' (Set.insert addressStateCodeHash visited) addressStateCodeHash >>= \case
            Just e@(ExternallyOwned _) -> pure $ Just e
            Just (SolidVMCode _ d) -> pure . Just $ SolidVMCode name d
            _ -> pure Nothing
        else pure Nothing
resolveCodePtr' _ cp = resolveCodePtr cp

resolveCodePtr ::
  ( Selectable Address AddressState m
  ) =>
  CodePtr ->
  m (Maybe CodePtr)
resolveCodePtr coa@(CodeAtAccount _ _) = resolveCodePtr' Set.empty coa
-- for solidVM/EVM code
resolveCodePtr cp = pure $ Just cp

unsafeResolveCodePtr :: Selectable Address AddressState m => CodePtr -> m (Maybe CodePtr)
unsafeResolveCodePtr (CodeAtAccount address name) =
  select Proxy address >>= \case
    Nothing -> pure Nothing
    Just AddressState {..} ->
      unsafeResolveCodePtr addressStateCodeHash >>= \case
        Just e@(ExternallyOwned _) -> pure $ Just e
        Just (SolidVMCode _ d) -> pure . Just $ SolidVMCode name d
        _ -> pure Nothing
unsafeResolveCodePtr codePtr = pure $ Just codePtr

resolveCodePtrParent :: Selectable Address AddressState m => CodePtr -> m (Maybe CodePtr)
resolveCodePtrParent (CodeAtAccount address _) =
  select Proxy address >>= \case
    Nothing -> pure Nothing
    Just AddressState {..} ->
      resolveCodePtrParent addressStateCodeHash >>= \case
        Just e@(ExternallyOwned _) -> pure $ Just e
        Just (SolidVMCode name' d) -> pure . Just $ SolidVMCode name' d
        _ -> pure Nothing
resolveCodePtrParent codePtr = pure $ Just codePtr

codePtrToSHA ::
  ( Selectable Address AddressState m
  ) =>
  CodePtr ->
  m (Maybe Keccak256)
codePtrToSHA =
  resolveCodePtr >=> \case
    Just (ExternallyOwned hsh) -> pure $ Just hsh
    Just (SolidVMCode _ hsh) -> pure $ Just hsh
    _ -> pure Nothing -- CodeAtAccount cannot happen here

resolvedCodePtrToSHA :: CodePtr -> Keccak256
resolvedCodePtrToSHA (ExternallyOwned hsh) = hsh
resolvedCodePtrToSHA (SolidVMCode _ hsh) = hsh
resolvedCodePtrToSHA _ = emptyHash

getAppAccount ::
  ( Selectable Address AddressState m
  ) =>
  Address ->
  m (Maybe Address)
getAppAccount address = do
  select Proxy address >>= \case
    Nothing -> pure Nothing
    Just AddressState {..} -> do
      case addressStateCodeHash of
        (CodeAtAccount pAcct _) -> getAppAccount pAcct
        _ -> pure $ Just address
