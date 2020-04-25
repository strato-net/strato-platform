module Blockchain.Strato.Model.Gas where

import           Control.DeepSeq (NFData)
import           GHC.Generics

newtype Gas = Gas Integer
  deriving newtype Num
  deriving newtype Integral
  deriving newtype Real
  deriving anyclass (NFData)
  deriving (Show, Read, Enum, Eq, Ord, Generic)
