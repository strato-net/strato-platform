{-# LANGUAGE ConstraintKinds  #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators    #-}

module Blockchain.Sequencer.DB.GetChainsDB where

import           Blockchain.ExtWord           (Word256)
import           Control.Monad.FT
import qualified Data.Set                     as S

newtype GetChainsDB = GetChainsDB { unGetChainsDB :: S.Set Word256 }

type HasGetChainsDB = Modifiable GetChainsDB

emptyGetChainsDB :: GetChainsDB
emptyGetChainsDB = GetChainsDB S.empty

insertGetChainsDB :: HasGetChainsDB m => Word256 -> m ()
insertGetChainsDB chainId = modifyPure_ $
  GetChainsDB . S.insert chainId . unGetChainsDB

clearGetChainsDB :: HasGetChainsDB m => m ()
clearGetChainsDB = put emptyGetChainsDB
