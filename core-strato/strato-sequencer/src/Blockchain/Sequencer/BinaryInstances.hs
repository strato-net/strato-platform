{-# OPTIONS_GHC -fno-warn-orphans #-}
module Blockchain.Sequencer.BinaryInstances() where

import           Data.Binary

import           Blockchain.Data.Address     ()
import qualified Blockchain.Data.ChainInfo   as CI
import           Blockchain.Data.TXOrigin    ()
import           GHC.Generics                ()

import           Blockchain.ExtWord          ()
import           Blockchain.SHA              ()

import           Data.ByteString             ()

instance Binary CI.ChainInfo where
    put gi = sequence_ $ map ($ gi) $
        [ put . CI.chainLabel
        , put . CI.accountInfo
        , put . CI.codeInfo
        , put . CI.members
        , put . CI.parentChain
        , put . CI.creationBlock
        , put . CI.chainNonce
        , put . CI.chainMetadata
        ]
    get = do
        chainLabel    <- get
        accountInfo   <- get
        codeInfo      <- get
        members       <- get
        parentChain   <- get
        creationBlock <- get
        chainNonce    <- get
        chainMetadata <- get
        chainR        <- get
        chainS        <- get
        chainV        <- get
        return $ CI.ChainInfo chainLabel
                              accountInfo
                              codeInfo
                              members
                              parentChain
                              creationBlock
                              chainNonce
                              chainMetadata
                              chainR
                              chainS
                              chainV

instance Binary CI.CodeInfo where
  put (CI.CodeInfo bs s1 s2) = put bs >> put s1 >> put s2
  get = CI.CodeInfo <$> get <*> get <*> get

instance Binary CI.AccountInfo where
  put (CI.NonContract a n) = putWord8 0 >> put a >> put n
  put (CI.ContractNoStorage a n s) = putWord8 1 >> put a >> put n >> put s
  put (CI.ContractWithStorage a n s ws) = putWord8 2 >> put a >> put n >> put s >> put ws
  get = do
    w8 <- getWord8
    case w8 of
      0 -> CI.NonContract <$> get <*> get
      1 -> CI.ContractNoStorage <$> get <*> get <*> get
      2 -> CI.ContractWithStorage <$> get <*> get <*> get <*> get
      n -> error $ "Binary CI.AccountInfo: Expected 0, 1, or 2, got: " ++ show n
