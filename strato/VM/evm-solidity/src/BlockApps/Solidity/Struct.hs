{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module BlockApps.Solidity.Struct where

import BlockApps.Solidity.Type
import qualified BlockApps.Storage as Storage
import Blockchain.Strato.Model.ExtendedWord
import Control.DeepSeq
import Data.Map.Ordered (OMap, assocs)
import Data.Text (Text)
import GHC.Generics

instance (NFData a, NFData b) => NFData (OMap a b) where
  rnf = rnf . assocs

data Struct = Struct
  { fields :: OMap Text (Either Text Storage.Position, Type),
    size :: Word256
  }
  deriving (Show, Generic, NFData)
