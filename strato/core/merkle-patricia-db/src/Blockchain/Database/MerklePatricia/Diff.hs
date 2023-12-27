{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.Database.MerklePatricia.Diff (dbDiff, DiffOp (..)) where

import Blockchain.Database.MerklePatricia.Internal
import Blockchain.Database.MerklePatricia.NodeData
import Conduit
import Control.Monad
import Control.Monad.Change.Alter
import Data.Function
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

diffChoice ::
  (StateRoot `Alters` NodeData) m =>
  Maybe N.Nibble ->
  MPChoice ->
  MPChoice ->
  ConduitT i DiffOp m ()
diffChoice n ch1 ch2 = case (ch1, ch2) of
  (None, Value v) -> yield $ Create sn v
  (Value v, None) -> yield $ Delete sn v
  (Value v1, Value v2)
    | v1 /= v2 -> yield $ Update sn v1 v2
  _
    | ch1 == ch2 -> return ()
    | otherwise -> pRecurse ch1 ch2
  where
    sn = maybe [] (: []) n
    prefix =
      let prepend n' op = op {key = n' : (key op)}
       in maybe id prepend n
    pRecurse = (.| awaitForever (yield . prefix)) .* recurse

diffChoices ::
  (StateRoot `Alters` NodeData) m =>
  [MPChoice] ->
  [MPChoice] ->
  ConduitT i DiffOp m ()
diffChoices =
  void .* sequence .* zipWith3 diffChoice maybeNums
  where
    maybeNums = Nothing : map Just [0 ..]

recurse ::
  (StateRoot `Alters` NodeData) m =>
  MPChoice ->
  MPChoice ->
  ConduitT i DiffOp m ()
recurse = join .* (liftM2 diffChoices `on` (lift . enter))

infixr 9 .*

(.*) :: (c -> d) -> (a -> b -> c) -> (a -> b -> d)
(.*) = (.) . (.)

diff ::
  (StateRoot `Alters` NodeData) m =>
  NodeRef ->
  NodeRef ->
  ConduitT i DiffOp m ()
diff = recurse `on` Ref

dbDiff ::
  (StateRoot `Alters` NodeData) m =>
  StateRoot ->
  StateRoot ->
  ConduitT i DiffOp m ()
dbDiff = diff `on` ptrRef
