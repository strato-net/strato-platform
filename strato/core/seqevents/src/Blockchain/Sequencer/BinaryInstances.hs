{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Sequencer.BinaryInstances () where

import qualified Blockchain.Data.ChainInfo as CI
import Blockchain.Data.TXOrigin ()
import Blockchain.Strato.Model.Address ()
import Blockchain.Strato.Model.ExtendedWord ()
import Blockchain.Strato.Model.Keccak256 ()
import Data.Binary
import Data.ByteString ()
import GHC.Generics ()

instance Binary CI.ChainSignature

instance Binary CI.UnsignedChainInfo

instance Binary CI.ChainInfo

instance Binary CI.CodeInfo

instance Binary CI.AccountInfo where
  put (CI.NonContract a n) = putWord8 0 >> put a >> put n
  put (CI.ContractNoStorage a n s) = putWord8 1 >> put a >> put n >> put s
  put (CI.ContractWithStorage a n s ws) = putWord8 2 >> put a >> put n >> put s >> put ws
  put (CI.SolidVMContractWithStorage a n s ws) = putWord8 3 >> put a >> put n >> put s >> put ws
  get = do
    w8 <- getWord8
    case w8 of
      0 -> CI.NonContract <$> get <*> get
      1 -> CI.ContractNoStorage <$> get <*> get <*> get
      2 -> CI.ContractWithStorage <$> get <*> get <*> get <*> get
      3 -> CI.ContractWithStorage <$> get <*> get <*> get <*> get
      n -> error $ "Binary CI.AccountInfo: Expected 0, 1, 2, or 3, got: " ++ show n
