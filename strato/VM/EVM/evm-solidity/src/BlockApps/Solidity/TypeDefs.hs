{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}

-- {-# OPTIONS_GHC -fno-warn-orphans #-}
module BlockApps.Solidity.TypeDefs where

-- , toList)

import BlockApps.Solidity.Struct
import Control.DeepSeq
import Data.Bimap (Bimap)
import Data.Map (Map)
import Data.Text (Text)
import GHC.Generics

type EnumSet = Bimap Int Text

--instance (NFData a, NFData b) => NFData (Bimap a b) where
--  rnf = rnf . toList

data TypeDefs = TypeDefs
  { enumDefs :: Map Text EnumSet,
    structDefs :: Map Text Struct
  }
  deriving (Show, Generic, NFData)
