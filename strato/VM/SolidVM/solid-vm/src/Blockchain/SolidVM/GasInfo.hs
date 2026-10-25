{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveFoldable #-}
-- {-# OPTIONS -fno-warn-unused-top-binds  #-}
{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DeriveTraversable #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeSynonymInstances #-}

module Blockchain.SolidVM.GasInfo
  ( GasInfo (..),
    gasLeft,
    gasUsed,
    gasInitialAllotment,
    gasMetadata,
    gasBlsG1Add,
    gasBlsG1MsmPerTerm,
    gasBlsG2Add,
    gasBlsG2MsmPerTerm,
    gasBlsPairingBase,
    gasBlsPairingPerPair,
    gasBlsMapFpToG1,
    gasBlsMapFp2ToG2,
    gasBlsDecompressG1,
    gasBlsDecompressG2,

  )
where

import Blockchain.Strato.Model.Gas
import Control.DeepSeq
import Control.Lens
import GHC.Generics

data GasInfo = GasInfo
  { _gasLeft :: Gas,
    _gasUsed :: Gas,
    _gasInitialAllotment :: Gas,
    _gasMetadata :: String
  }
  deriving (Show, Generic, NFData)

makeLenses ''GasInfo

gasBlsG1Add, gasBlsG1MsmPerTerm, gasBlsG2Add, gasBlsG2MsmPerTerm :: Gas
gasBlsG1Add = 4000
gasBlsG1MsmPerTerm = 2500
gasBlsG2Add = 9000
gasBlsG2MsmPerTerm = 9000

gasBlsPairingBase, gasBlsPairingPerPair :: Gas
gasBlsPairingBase = 50000
gasBlsPairingPerPair = 20000

gasBlsMapFpToG1, gasBlsMapFp2ToG2, gasBlsDecompressG1, gasBlsDecompressG2 :: Gas
gasBlsMapFpToG1 = 5000
gasBlsMapFp2ToG2 = 20000
gasBlsDecompressG1 = 5000
gasBlsDecompressG2 = 20000
