{-# LANGUAGE ConstraintKinds       #-}
{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE TemplateHaskell       #-}
{-# LANGUAGE TypeOperators         #-}
module Blockchain.Sequencer.DB.SeenTransactionDB where

import           Blockchain.SHA
import           Blockchain.Sequencer.DB.Witnessable
import           Control.Applicative
import           Control.Arrow                ((&&&))
import           Control.Lens
import           Control.Monad.Change.Alter
import           Control.Monad.Change.Modify
import qualified Data.Sequence                as Q
import qualified Data.Set                     as S
import           Prelude                      hiding (and, or, not, lookup)

fromBool :: Bool -> Maybe ()
fromBool b = if b then Just () else Nothing

toBool :: Maybe () -> Bool
toBool = maybe False $ const True

-- TODO: Although this is correct, it looks and feels a little awkward.
--       Perhaps there could be a better class for Set-like contexts.
type HasSeenTransactionDB = SHA `Alters` ()

data SeenTransactionDB = SeenTransactionDB
  { _size       :: Int
  , _operations :: Int -- track number of pushes to start popping after `size`
  , _clearQueue :: Q.Seq SHA
  , _seen       :: S.Set SHA
  }
makeLenses ''SeenTransactionDB

mkSeenTxDB :: Int -> SeenTransactionDB
mkSeenTxDB dbSize = SeenTransactionDB
  { _size       = dbSize
  , _operations = 0
  , _clearQueue = Q.empty
  , _seen       = S.empty
  }

genericLookupSeenTransactionDB :: Modifiable SeenTransactionDB m => SHA -> m (Maybe ())
genericLookupSeenTransactionDB sha = fromBool . S.member sha . _seen <$> get Proxy

genericInsertSeenTransactionDB :: Modifiable SeenTransactionDB m => SHA -> () -> m ()
genericInsertSeenTransactionDB sha = const $ modify_ Proxy $ pure . witnessTransactionHash' sha

genericDeleteSeenTransactionDB :: Modifiable SeenTransactionDB m => SHA -> m ()
genericDeleteSeenTransactionDB sha = modify_ Proxy $ pure . (seen %~ S.delete sha)

wasTransactionHashWitnessed :: HasSeenTransactionDB m => SHA -> m Bool
wasTransactionHashWitnessed = fmap toBool . lookup Proxy

wasTransactionWitnessed :: (Witnessable t, HasSeenTransactionDB m) => t -> m Bool
wasTransactionWitnessed = fmap toBool . lookup Proxy . witnessableHash

witnessTransaction :: (Witnessable t, HasSeenTransactionDB m) => t -> m ()
witnessTransaction t = insert Proxy (witnessableHash t) ()

witnessTransactionHash :: HasSeenTransactionDB m => SHA -> m ()
witnessTransactionHash sha = insert Proxy sha ()

witnessTransactionHash' :: SHA -> SeenTransactionDB -> SeenTransactionDB
witnessTransactionHash' sha stxdb =
  let withClear = stxdb
        & operations +~ 1
        & clearQueue %~ flip (Q.|>) sha
        & seen       %~ S.insert sha
      withIntBoundFix =
        if _operations withClear >= 0
          then withClear
          else withClear -- prevent Int rollover since were comparing to size which is int
                 & operations .~ _size withClear + 1
   in if uncurry (<) $ (_operations &&& _size) withIntBoundFix
        then withIntBoundFix
        else case Q.viewl (_clearQueue withIntBoundFix) of
               Q.EmptyL    -> withIntBoundFix
               (q Q.:< qs) -> withIntBoundFix
                                & clearQueue .~ qs
                                & seen %~ S.delete q
