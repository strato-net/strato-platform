
module Blockchain.Sequencer.DB.SeenChainDB where

import           Blockchain.ExtWord           (Word256)

import qualified Data.Set                     as S

getSeenChainsDB :: HasPrivateHashDB m => m (S.Set Word256)
getSeenChainsDB = seenChains <$> getPrivateHashDB

putSeenChainsDB :: HasPrivateHashDB m => S.Set Word256 -> m ()
putSeenChainsDB m = getPrivateHashDB >>= \db -> putPrivateHashDB db{ seenChains = m }

lookupSeenChain :: HasPrivateHashDB m => Word256 -> m Bool
lookupSeenChain chainId = S.member chainId <$> getSeenChainsDB

insertSeenChain :: HasPrivateHashDB m => Word256 -> m ()
insertSeenChain chainId = getSeenChainsDB >>= putSeenChainsDB . S.insert chainId
