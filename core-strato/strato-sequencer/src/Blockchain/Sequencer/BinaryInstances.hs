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

instance Binary CI.ChainSignature where
    put gi = sequence_ . map ($ gi) $
        [ put . CI.chainR
        , put . CI.chainS
        , put . CI.chainV
        ]
    get = CI.ChainSignature
          <$> get
          <*> get
          <*> get

instance Binary CI.ChainInfo where
    put gi = sequence_ $ map ($ gi) $
        [ put . CI.chainLabel     . CI.chainInfo
        , put . CI.accountInfo    . CI.chainInfo
        , put . CI.codeInfo       . CI.chainInfo
        , put . CI.members        . CI.chainInfo
        , put . CI.parentChain    . CI.chainInfo
        , put . CI.creationBlock  . CI.chainInfo
        , put . CI.chainNonce     . CI.chainInfo
        , put . CI.chainMetadata  . CI.chainInfo
        , put . CI.chainSignature
        ]
    get = CI.ChainInfo
          <$> (CI.UnsignedChainInfo
              <$> get
              <*> get
              <*> get
              <*> get
              <*> get
              <*> get
              <*> get
              <*> get
              )
          <*> get

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
