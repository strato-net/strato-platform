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
    codePtrToSHA
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

instance {-# OVERLAPPING #-} Selectable Address AddressState m => Selectable Address AddressState (MainChainT m) where
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

codePtrToSHA :: CodePtr -> Keccak256
codePtrToSHA (ExternallyOwned hsh) = hsh
codePtrToSHA (SolidVMCode _ hsh) = hsh
