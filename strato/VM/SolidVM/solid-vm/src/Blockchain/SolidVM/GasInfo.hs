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
    remainingGas,
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

-- | Remaining transaction gas as the integer carried by 'ExecResults'.
-- Keeping this conversion next to the meter avoids successful SolidVM calls
-- accidentally reverting to the historical "consume the whole limit" value.
remainingGas :: GasInfo -> Integer
remainingGas = getGasValue . _gasLeft
