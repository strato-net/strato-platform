{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
module Blockchain.Sequencer.DB.SeenTransactionDB where

import           Blockchain.SHA
import           Blockchain.Sequencer.DB.Witnessable
import           Control.Monad.IO.Class

import qualified Data.Sequence                as Q
import qualified Data.Set                     as S

data SeenTransactionDB =
     SeenTransactionDB { size       :: Int
                       , operations :: Int -- track number of pushes to start popping after `size`
                       , clearQueue :: Q.Seq SHA
                       , seen       :: S.Set SHA
                       }

mkSeenTxDB :: Int -> SeenTransactionDB
mkSeenTxDB dbSize = SeenTransactionDB { size       = dbSize
                                      , operations = 0
                                      , clearQueue = Q.empty
                                      , seen       = S.empty
                                      }

class (MonadIO m) => HasSeenTransactionDB m where
    getSeenTransactionDB :: m SeenTransactionDB
    putSeenTransactionDB :: SeenTransactionDB -> m ()
    {-# MINIMAL getSeenTransactionDB, putSeenTransactionDB #-}

    wasTransactionHashWitnessed :: SHA -> m Bool
    wasTransactionHashWitnessed sha = (S.member sha . seen) <$> getSeenTransactionDB

    witnessTransactionHash :: SHA -> m ()
    witnessTransactionHash sha = do
        stxdb     <- getSeenTransactionDB
        let withClear = stxdb { operations = operations stxdb + 1
                              , clearQueue = clearQueue stxdb Q.|> sha
                              , seen       = sha `S.insert` seen stxdb
                              }
            withIntBoundFix = if operations withClear >= 0
                    then withClear
                    else withClear { operations = size withClear + 1 } -- prevent Int rollover since were comparing to size which is int
            withPop = if operations withIntBoundFix < size withIntBoundFix
                        then withIntBoundFix
                        else
                            case Q.viewl (clearQueue withIntBoundFix) of
                                Q.EmptyL    -> withIntBoundFix
                                (q Q.:< qs) -> withIntBoundFix { clearQueue = qs, seen = q `S.delete` seen withIntBoundFix }
        putSeenTransactionDB withPop

    wasTransactionWitnessed :: Witnessable t => t -> m Bool
    wasTransactionWitnessed  = wasTransactionHashWitnessed . witnessableHash

    witnessTransaction      :: Witnessable t => t -> m ()
    witnessTransaction       = witnessTransactionHash . witnessableHash
