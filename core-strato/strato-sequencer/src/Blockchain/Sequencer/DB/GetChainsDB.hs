{-# LANGUAGE ConstraintKinds  #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators    #-}

module Blockchain.Sequencer.DB.GetChainsDB where

import           Blockchain.ExtWord           (Word256)
import           Control.Monad.Change.Modify
import qualified Data.Set                     as S

newtype GetChainsDB = GetChainsDB { unGetChainsDB :: S.Set Word256 }

type HasGetChainsDB = Modifiable GetChainsDB

emptyGetChainsDB :: GetChainsDB
emptyGetChainsDB = GetChainsDB S.empty

insertGetChainsDB :: HasGetChainsDB m => Word256 -> m ()
insertGetChainsDB chainId = modify_ Proxy $
  pure . GetChainsDB . S.insert chainId . unGetChainsDB

clearGetChainsDB :: HasGetChainsDB m => m ()
clearGetChainsDB = put (Proxy @GetChainsDB) emptyGetChainsDB
