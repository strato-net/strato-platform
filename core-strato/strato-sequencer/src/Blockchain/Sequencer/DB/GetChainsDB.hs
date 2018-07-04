
module Blockchain.Sequencer.DB.GetChainsDB where

import           Blockchain.ExtWord           (Word256)
import qualified Data.Set                     as S

class Monad m => HasGetChainsDB m where
    getGetChainsDB :: m (S.Set Word256)
    putGetChainsDB :: (S.Set Word256) -> m ()

insertGetChainsDB :: HasGetChainsDB m => Word256 -> m ()
insertGetChainsDB tx = getGetChainsDB >>= putGetChainsDB . S.insert tx

clearGetChainsDB :: HasGetChainsDB m => m ()
clearGetChainsDB = putGetChainsDB S.empty
