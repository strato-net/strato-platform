{-# LANGUAGE ConstraintKinds  #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators    #-}

module Blockchain.Sequencer.DB.GetChainsDB where

import           Blockchain.ExtWord           (Word256)
import           Control.Monad.Change.Modify
import qualified Data.Set                     as S

type HasGetChainsDB = Modifiable (S.Set Word256)

insertGetChainsDB :: HasGetChainsDB m => Word256 -> m ()
insertGetChainsDB chainId = modify_ Proxy $ pure . S.insert chainId

clearGetChainsDB :: HasGetChainsDB m => m ()
clearGetChainsDB = put (Proxy @(S.Set Word256)) S.empty
