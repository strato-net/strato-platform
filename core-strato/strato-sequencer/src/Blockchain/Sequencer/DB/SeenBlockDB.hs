
module Blockchain.Sequencer.DB.SeenBlockDB where

import           Blockchain.Data.DataDefs     (BlockData(..))
module           Blockchain.Sequencer.DB.SeenTransactionDB
import           Blockchain.SHA

import           Data.Map.Strict              (Map)
import qualified Data.Map.Strict              as M
import qualified Data.Sequence                as Q

data SeenBlockDB =
     SeenBlockDB { size       :: Int
                 , operations :: Int -- track number of pushes to start popping after `size`
                 , clearQueue :: Q.Seq SHA
                 , seen       :: Map SHA BlockData
                 }

mkSeenTxDB :: Int -> SeenBlockDB
mkSeenTxDB dbSize = SeenBlockDB { size       = dbSize
                                , operations = 0
                                , clearQueue = Q.empty
                                , seen       = M.empty
                                }

class (MonadResource m) => HasSeenBlockDB m where
    getSeenBlockDB :: m SeenBlockDB
    putSeenBlockDB :: SeenBlockDB -> m ()
    {-# MINIMAL getSeenBlockDB, putSeenBlockDB #-}

    wasBlockHashWitnessed :: HasSeenBlockDB m => SHA -> m Bool
    wasBlockHashWitnessed sha = (M.member sha . seen) <$> getSeenBlockDB

    witnessedBlock :: HasSeenBlockDB m => SHA -> m (Maybe BlockData)
    witnessedBlock sha = (M.lookup sha . seen) <$> getSeenBlockDB

    witnessBlockHash :: HasSeenBlockDB m => SHA -> m ()
    witnessBlockHash sha = do
        stxdb     <- getSeenBlockDB
        let withClear = stxdb { operations = operations stxdb + 1
                              , clearQueue = clearQueue stxdb Q.|> sha
                              , seen       = sha `M.insert` seen stxdb
                              }
            withIntBoundFix = if operations withClear >= 0
                    then withClear
                    else withClear { operations = size withClear + 1 } -- prevent Int rollover since were comparing to size which is int
            withPop = if operations withIntBoundFix < size withIntBoundFix
                        then withIntBoundFix
                        else
                            case Q.viewl (clearQueue withIntBoundFix) of
                                Q.EmptyL    -> withIntBoundFix
                                (q Q.:< qs) -> withIntBoundFix { clearQueue = qs, seen = q `M.delete` seen withIntBoundFix }
        putSeenBlockDB withPop

    wasBlockWitnessed :: (HasSeenBlockDB m, Witnessable t) => t -> m Bool
    wasBlockWitnessed  = wasBlockHashWitnessed . witnessableHash

    witnessBlock      :: (HasSeenBlockDB m, Witnessable t) => t -> m ()
    witnessBlock       = witnessBlockHash . witnessableHash
