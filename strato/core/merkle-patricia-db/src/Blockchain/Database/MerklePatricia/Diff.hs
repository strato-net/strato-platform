{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.Database.MerklePatricia.Diff (dbDiff, DiffOp (..)) where

import Blockchain.Database.MerklePatricia.Internal
import Blockchain.Database.MerklePatricia.NodeData
import Control.Monad
import Control.Monad.Change.Alter
import qualified Data.NibbleString as N

data MPChoice = Data NodeData | Ref NodeRef | Value Val | None deriving (Eq)

node ::
  (StateRoot `Alters` NodeData) m =>
  MPChoice ->
  m NodeData
node (Data nd) = return nd
node (Ref nr) = getNodeData nr
node _ = return EmptyNodeData

simplify :: NodeData -> [MPChoice]
simplify EmptyNodeData = replicate 17 None -- 17: not a mistake
simplify FullNodeData {choices = ch, nodeVal = v} =
  maybe None Value v : map Ref ch
simplify n@ShortcutNodeData {nextNibbleString = k, nextVal = v} = None : delta h
  where
    delta m =
      let pre = replicate m None
          post = replicate (16 - m - 1) None
       in pre ++ [x] ++ post
    x
      | N.null t = either Ref Value v
      | otherwise = Data n {nextNibbleString = t}
    (h, t) = (fromIntegral $ N.head k, N.tail k)

enter :: (StateRoot `Alters` NodeData) m => MPChoice -> m [MPChoice]
enter = liftM simplify . node

data DiffOp
  = Create {key :: [N.Nibble], val :: Val}
  | Update {key :: [N.Nibble], oldVal :: Val, newVal :: Val}
  | Delete {key :: [N.Nibble], oldVal :: Val}
  deriving (Show, Eq)

-- | Diff two choices. @path@ is the reversed nibble path down to this point;
-- results are accumulated in reverse onto @acc@.
diffChoice ::
  (StateRoot `Alters` NodeData) m =>
  [N.Nibble] ->
  [DiffOp] ->
  MPChoice ->
  MPChoice ->
  m [DiffOp]
diffChoice path acc ch1 ch2 = case (ch1, ch2) of
  (None, Value v) -> pure $ Create (reverse path) v : acc
  (Value v, None) -> pure $ Delete (reverse path) v : acc
  (Value v1, Value v2)
    | v1 /= v2 -> pure $ Update (reverse path) v1 v2 : acc
  _
    | ch1 == ch2 -> pure acc
    | otherwise -> recurse path acc ch1 ch2

recurse ::
  (StateRoot `Alters` NodeData) m =>
  [N.Nibble] ->
  [DiffOp] ->
  MPChoice ->
  MPChoice ->
  m [DiffOp]
recurse path acc ch1 ch2 = do
  cs1 <- enter ch1
  cs2 <- enter ch2
  foldM step acc (zip3 maybeNums cs1 cs2)
  where
    maybeNums = Nothing : map Just [0 ..]
    step a (n, c1, c2) = diffChoice (maybe path (: path) n) a c1 c2

dbDiff ::
  (StateRoot `Alters` NodeData) m =>
  StateRoot ->
  StateRoot ->
  m [DiffOp]
dbDiff r1 r2 = reverse <$> recurse [] [] (Ref (ptrRef r1)) (Ref (ptrRef r2))
