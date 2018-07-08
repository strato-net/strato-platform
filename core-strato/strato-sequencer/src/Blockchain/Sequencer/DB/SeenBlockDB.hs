{-# OPTIONS -fno-warn-orphans #-}

module Blockchain.Sequencer.DB.SeenBlockDB where

import           Blockchain.Sequencer.Event    (OutputBlock(..))
import           Blockchain.Sequencer.DB.Witnessable
import           Blockchain.SHA
import           Blockchain.Strato.Model.Class (blockHeaderHash)

import           Control.Monad.Trans.Resource

import           Data.Map.Strict              (Map)
import qualified Data.Map.Strict              as M
import qualified Data.Sequence                as Q

data SeenBlockDB =
     SeenBlockDB { size       :: Int
                 , operations :: Int -- track number of pushes to start popping after `size`
                 , clearQueue :: Q.Seq SHA
                 , seen       :: Map SHA OutputBlock
                 }

mkSeenBlockDB :: Int -> SeenBlockDB
mkSeenBlockDB dbSize = SeenBlockDB { size       = dbSize
                                   , operations = 0
                                   , clearQueue = Q.empty
                                   , seen       = M.empty
                                   }

instance Witnessable OutputBlock where
    witnessableHash = blockHeaderHash . obBlockData

class (MonadResource m) => HasSeenBlockDB m where
    getSeenBlockDB :: m SeenBlockDB
    putSeenBlockDB :: SeenBlockDB -> m ()
    {-# MINIMAL getSeenBlockDB, putSeenBlockDB #-}

    wasBlockHashWitnessed :: SHA -> m Bool
    wasBlockHashWitnessed sha = (M.member sha . seen) <$> getSeenBlockDB

    witnessedBlock :: SHA -> m (Maybe OutputBlock)
    witnessedBlock sha = (M.lookup sha . seen) <$> getSeenBlockDB

    witnessBlockHash :: SHA -> OutputBlock -> m ()
    witnessBlockHash sha bd = do
        stxdb     <- getSeenBlockDB
        let withClear = stxdb { operations = operations stxdb + 1
                              , clearQueue = clearQueue stxdb Q.|> sha
                              , seen       = M.insert sha bd $ seen stxdb
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

    wasBlockWitnessed :: Witnessable t => t -> m Bool
    wasBlockWitnessed = wasBlockHashWitnessed . witnessableHash

    witnessBlock :: OutputBlock -> m ()
    witnessBlock bd = witnessBlockHash (witnessableHash bd) bd
