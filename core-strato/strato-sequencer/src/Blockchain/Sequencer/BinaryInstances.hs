{-# OPTIONS_GHC -fno-warn-orphans #-}
module Blockchain.Sequencer.BinaryInstances() where

import           Data.Binary

import           Blockchain.Data.Address     ()
import qualified Blockchain.Data.GenesisInfo as GI
import qualified Blockchain.Data.ChainInfo   as CI
import           Blockchain.Data.TXOrigin    ()
import           GHC.Generics                ()

import           Blockchain.ExtWord          ()
import           Blockchain.SHA              ()

import           Data.ByteString             ()

instance Binary CI.ChainInfo where
    put gi = sequence_ $ map ($ gi) $
        [ put. CI.chainLabel
        , put. CI.addRule
        , put. CI.removeRule
        , put. CI.members
        , put. CI.accountBalance
        ]
    get = do
        chainLabel      <- get
        addRule         <- get
        removeRule      <- get
        members         <- get
        accountBalance  <- get
        return $ CI.ChainInfo chainLabel addRule removeRule members accountBalance

instance Binary GI.CodeInfo where
  put (GI.CodeInfo bs s1 s2) = put bs >> put s1 >> put s2
  get = GI.CodeInfo <$> get <*> get <*> get

instance Binary GI.AccountInfo where
  put (GI.NonContract a n) = putWord8 0 >> put a >> put n
  put (GI.ContractNoStorage a n s) = putWord8 1 >> put a >> put n >> put s
  put (GI.ContractWithStorage a n s ws) = putWord8 2 >> put a >> put n >> put s >> put ws
  get = do
    w8 <- getWord8
    case w8 of
      0 -> GI.NonContract <$> get <*> get
      1 -> GI.ContractNoStorage <$> get <*> get <*> get
      2 -> GI.ContractWithStorage <$> get <*> get <*> get <*> get
      n -> error $ "Binary GI.AccountInfo: Expected 0, 1, or 2, got: " ++ show n
