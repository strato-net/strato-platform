{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.Sequencer.DB.SeenTransactionDB where

import Blockchain.Sequencer.DB.Witnessable
import Blockchain.Strato.Model.Keccak256
import Control.Applicative
import Control.Lens
import Control.Monad.Change.Alter
import Control.Monad.Change.Modify
import qualified Data.Sequence as Q
import qualified Data.Set as S
import Prelude hiding (and, lookup, not, or)

fromBool :: Bool -> Maybe ()
fromBool b = if b then Just () else Nothing

toBool :: Maybe () -> Bool
toBool = maybe False $ const True

-- TODO: Although this is correct, it looks and feels a little awkward.
--       Perhaps there could be a better class for Set-like contexts.
type HasSeenTransactionDB = Keccak256 `Alters` ()

data SeenTransactionDB = SeenTransactionDB
  { _size :: {-# UNPACK #-} !Int,
    _operations :: {-# UNPACK #-} !Int, -- track number of pushes to start popping after `size`
    _clearQueue :: !(Q.Seq Keccak256),
    _seen :: !(S.Set Keccak256)
  }

makeLenses ''SeenTransactionDB

mkSeenTxDB :: Int -> SeenTransactionDB
mkSeenTxDB dbSize =
  SeenTransactionDB
    { _size = dbSize,
      _operations = 0,
      _clearQueue = Q.empty,
      _seen = S.empty
    }

genericLookupSeenTransactionDB :: Modifiable SeenTransactionDB m => Keccak256 -> m (Maybe ())
genericLookupSeenTransactionDB sha = fromBool . S.member sha . _seen <$> get Proxy

genericInsertSeenTransactionDB :: Modifiable SeenTransactionDB m => Keccak256 -> () -> m ()
genericInsertSeenTransactionDB sha = const $ modify_ Proxy $ pure . witnessTransactionHash' sha

genericDeleteSeenTransactionDB :: Modifiable SeenTransactionDB m => Keccak256 -> m ()
genericDeleteSeenTransactionDB sha = modify_ Proxy $ pure . (seen %~ S.delete sha)

wasTransactionHashWitnessed :: HasSeenTransactionDB m => Keccak256 -> m Bool
wasTransactionHashWitnessed = fmap toBool . lookup Proxy

wasTransactionWitnessed :: (Witnessable t, HasSeenTransactionDB m) => t -> m Bool
wasTransactionWitnessed = fmap toBool . lookup Proxy . witnessableHash

witnessTransaction :: (Witnessable t, HasSeenTransactionDB m) => t -> m ()
witnessTransaction t = insert Proxy (witnessableHash t) ()

witnessTransactionHash :: HasSeenTransactionDB m => Keccak256 -> m ()
witnessTransactionHash sha = insert Proxy sha ()

witnessTransactionHash' :: Keccak256 -> SeenTransactionDB -> SeenTransactionDB
witnessTransactionHash' sha stxdb =
  let withClear =
        stxdb
          & operations +~ 1
          & clearQueue %~ flip (Q.|>) sha
          & seen %~ S.insert sha
      withIntBoundFix =
        if _operations withClear >= 0
          then withClear
          else
            withClear -- prevent Int rollover since were comparing to size which is int
              & operations .~ _size withClear + 1
   in if _operations withIntBoundFix < _size withIntBoundFix
        then withIntBoundFix
        else case Q.viewl (_clearQueue withIntBoundFix) of
          Q.EmptyL -> withIntBoundFix
          (q Q.:< qs) ->
            withIntBoundFix
              & clearQueue .~ qs
              & seen %~ S.delete q
