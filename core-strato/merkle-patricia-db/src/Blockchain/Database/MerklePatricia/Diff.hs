module Blockchain.Database.MerklePatricia.Diff (dbDiff, DiffOp(..)) where

import           Blockchain.Database.MerklePatricia.Internal
import           Blockchain.Database.MerklePatricia.NodeData

import           Control.Monad
import           Control.Monad.IO.Class
import           Control.Monad.Trans.Class
import           Control.Monad.Trans.Reader
import           Data.Function
import qualified Data.NibbleString                           as N
import qualified Data.Vector                                 as V

-- Probably the entire MPDB system ought to be in this monad
type MPReaderM a = ReaderT MPDB a

data MPChoice = Data NodeData | Ref NodeRef | Value Val | None deriving (Eq)

node :: MonadIO m=>MPChoice -> MPReaderM m NodeData
node (Data nd) = return nd
node (Ref nr) = do
  derefNode <- asks getNodeData
  lift $ derefNode nr
node _ = return EmptyNodeData

simplify :: NodeData -> [MPChoice]
simplify EmptyNodeData = replicate 17 None -- 17: not a mistake
simplify FullNodeData{ choices = ch, nodeVal = v } =
  maybe None Value v : V.toList (V.map Ref ch)
simplify n@ShortcutNodeData{ nextNibbleString = k, nextVal = v } = None : delta h
  where
    delta m =
      let pre = replicate m None
          post = replicate (16 - m - 1) None
      in pre ++ [x] ++ post
    x | N.null t  = either Ref Value v
      | otherwise = Data n{ nextNibbleString = t }
    (h,t) = (fromIntegral $ N.head k, N.tail k)

enter :: MonadIO m=>MPChoice -> MPReaderM m [MPChoice]
enter = liftM simplify . node

data DiffOp =
  Create {key::[N.Nibble], val::Val} |
  Update {key::[N.Nibble], oldVal::Val, newVal::Val} |
  Delete {key::[N.Nibble], oldVal::Val}
  deriving (Show, Eq)

diffChoice :: MonadIO m=>Maybe N.Nibble -> MPChoice -> MPChoice -> MPReaderM m [DiffOp]
diffChoice n ch1 ch2 = case (ch1, ch2) of
  (None, Value v) -> return [Create sn v]
  (Value v, None) -> return [Delete sn v]
  (Value v1, Value v2)
    | v1 /= v2     -> return [Update sn v1 v2]
  _ | ch1 == ch2   -> return []
    | otherwise   -> pRecurse ch1 ch2
  where
    sn = maybe [] (:[]) n
    prefix =
      let prepend n' op = op{key = n':(key op)}
      in map (maybe id prepend n)
    pRecurse = liftM prefix .* recurse

diffChoices :: MonadIO m=>[MPChoice] -> [MPChoice] -> MPReaderM m [DiffOp]
diffChoices =
  liftM concat .* sequence .* zipWith3 diffChoice maybeNums
  where maybeNums = Nothing : map Just [0..]

recurse :: MonadIO m=>MPChoice -> MPChoice -> MPReaderM m [DiffOp]
recurse = join .* (liftM2 diffChoices `on` enter)

infixr 9 .*
(.*) :: (c -> d) -> (a -> b -> c) -> (a -> b -> d)
(.*) = (.) . (.)

diff :: MonadIO m=>NodeRef -> NodeRef -> MPReaderM m [DiffOp]
diff = recurse `on` Ref

dbDiff :: MonadIO m => MPDB -> StateRoot -> StateRoot -> m [DiffOp]
dbDiff db root1 root2 = runReaderT ((diff `on` PtrRef) root1 root2) db
