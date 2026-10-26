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
