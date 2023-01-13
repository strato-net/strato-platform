-- {-# OPTIONS -fno-warn-unused-top-binds  #-}

{-# LANGUAGE DeriveFunctor      #-}
{-# LANGUAGE DeriveGeneric      #-}
{-# LANGUAGE TemplateHaskell    #-}
{-# LANGUAGE DeriveFoldable     #-}
{-# LANGUAGE DeriveTraversable  #-}
{-# LANGUAGE DeriveAnyClass     #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE FlexibleInstances    #-}

module Blockchain.SolidVM.GasInfo (
  GasInfo(..),
  gasLeft,
  gasInitalAllotment,
  gasMetadata
  ) where


import Control.Lens
import GHC.Generics
import Control.DeepSeq
import Blockchain.Strato.Model.Gas

data GasInfo = GasInfo {
    _gasLeft :: Gas,
    _gasInitalAllotment :: Gas, 
    _gasMetadata :: String
  } deriving (Show, Generic, NFData)

makeLenses ''GasInfo
