{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_HADDOCK hide, prune #-}

module BatchMerge
  ( putManyKeyVal,
    putManyKeyValExisted,
  )
where

import BlockApps.Logging
import qualified Blockchain.Database.MerklePatricia as MP
import qualified Blockchain.Database.MerklePatricia.Internal as MP
import qualified Blockchain.Database.MerklePatricia.NodeData as MP
import Blockchain.Strato.Model.Keccak256 (hash, keccak256ToByteString)
import Control.Monad
import qualified Control.Monad.Change.Alter as A
import Data.Maybe
import qualified Data.NibbleString as N
import FastMP
import KV
import ReverseOrderedKVs

putManyKeyVal ::
  (MonadLogger m, (MP.StateRoot `A.Alters` MP.NodeData) m) =>
  MP.StateRoot ->
  [(MP.Key, MP.Val)] ->
  m MP.StateRoot
putManyKeyVal sr listOfInserts = fst <$> putManyKeyValExisted sr listOfInserts

-- | 'putManyKeyVal' that also returns which of the given keys already had a
-- value in the trie.
putManyKeyValExisted ::
  (MonadLogger m, (MP.StateRoot `A.Alters` MP.NodeData) m) =>
  MP.StateRoot ->
  [(MP.Key, MP.Val)] ->
  m (MP.StateRoot, [MP.Key])
putManyKeyValExisted sr listOfInserts = do
  let safeKeys = map (MP.keyToSafeKey . fst) listOfInserts
      listOfInserts' = zip safeKeys (map snd listOfInserts)
      backToOriginal = zip (map N.unpack safeKeys) (map fst listOfInserts)

  nd <- MP.getNodeData $ MP.ptrRef sr

  (finalNd, existedSafe) <- putManyKeyVal_nodeData nd $ orderTheKVs $ map (uncurry createKV) listOfInserts'

  nr <- MP.nodeData2NodeRef finalNd

  sr' <- case nr of
    Right sr' -> return sr'
    Left v -> do
      -- The whole trie is too small to fit in a level db key, just create a stateroot from the full data....
      let newSR = MP.StateRoot $ keccak256ToByteString $ hash v
      A.insert (A.Proxy @MP.NodeData) newSR finalNd
      return newSR
  return (sr', mapMaybe (`lookup` backToOriginal) existedSafe)

splitKeysByPrefix :: [Maybe N.Nibble] -> [KV] -> [[KV]]
splitKeysByPrefix [] [] = []
splitKeysByPrefix [] _ = error "in call to splitKeysByPrefix, keys are out of order"
splitKeysByPrefix (firstChar : remainingPrefix) kvs =
  let (matched, remaining) = span ((== firstChar) . listToMaybe . theKey) kvs
   in case firstChar of
        Just _ -> let unsafeTail []     = error "splitKeysByPrefix: empty key"
                      unsafeTail (_:xs) = xs
                   in map (\(KV k v) -> (KV (unsafeTail k) v)) matched : splitKeysByPrefix remainingPrefix remaining
        Nothing -> matched : splitKeysByPrefix remainingPrefix remaining

-- Returns the rebuilt node plus the keys (relative to this node) that already
-- held a value before the insert.
putManyKeyVal_nodeData ::
  (MonadLogger m, (MP.StateRoot `A.Alters` MP.NodeData) m) =>
  MP.NodeData ->
  ReverseOrderedKVs ->
  m (MP.NodeData, [[N.Nibble]])
putManyKeyVal_nodeData (MP.FullNodeData choices val) listOfInserts = do
  let kvsSplitByFirstNibble = splitKeysByPrefix (map Just [15, 14 .. 0] ++ [Nothing]) $ getTheKVs listOfInserts

  results <-
    forM (zip3 [15, 14 .. 0] kvsSplitByFirstNibble $ reverse choices) $ \(nibble, newVals, oldVal) -> do
      if null newVals
        then return (oldVal, [])
        else do
          oldNd <- MP.getNodeData oldVal
          (nd, existed) <- putManyKeyVal_nodeData oldNd $ iPromiseTheseKVsAreOrdered newVals
          ref <- MP.nodeData2NodeRef nd
          return (ref, map (nibble :) existed)

  let (val', existedHere) =
        case last kvsSplitByFirstNibble of
          [] -> (val, [])
          [KV _ (Right x)] -> (Just x, [[] | isJust val])
          x -> error $ "internal error: forbidden pattern match in call to putManyKeyVal_nodeData: " ++ show x

  return (MP.FullNodeData (reverse $ map fst results) val', existedHere ++ concatMap snd results)
putManyKeyVal_nodeData (MP.ShortcutNodeData k (Right v)) listOfInserts = do
  let key = N.unpack k
      existed = [key | any ((== key) . theKey) (getTheKVs listOfInserts)]
  nd <- createMPFast_NodeData $ insertKV_ignoreIfExists listOfInserts $ KV key $ Right v
  return (nd, existed)
putManyKeyVal_nodeData (nd@(MP.ShortcutNodeData _ (Left _))) listOfInserts = do
  --OK, this case should be extrememly rare (since keys are always randomized by a hash function anyway).
  --This is both theoretically obvious, and seems to be empirically true in the times I have
  --already run things (this case hasn't been triggered yet).
  --Also, filling in this case properly will be a bit tricky....  new keys could have the same
  --prefix given in the ShortcutNodeData, or part of it, or none at all.  All three of these will
  --involve very different results.
  --Since this is difficult and rare, I am going to just default to slow one-by-one inserts for
  --now....

  foldM
    ( \(ndAcc, existed) (KV k v) -> case v of
        Right v' -> do
          (nd', e) <- MP.putKV_NodeData (N.pack k) v' ndAcc
          return (nd', if e then k : existed else existed)
        Left _ -> error "Unsupported case: KV with Left value"
    )
    (nd, [])
    (getTheKVs listOfInserts)
putManyKeyVal_nodeData MP.EmptyNodeData listOfInserts = do
  nd <- createMPFast_NodeData listOfInserts
  return (nd, [])

createKV :: MP.Key -> MP.Val -> KV
createKV k v = KV (N.unpack k) $ Right v

insertKV_ignoreIfExists :: ReverseOrderedKVs -> KV -> ReverseOrderedKVs
insertKV_ignoreIfExists reverseOrderedKVs newKV =
  let kvs = getTheKVs reverseOrderedKVs
      insertAtCorrectPlace :: KV -> [KV] -> [KV]
      insertAtCorrectPlace (KV kNew _) (KV k v : rest) | kNew == k = KV k v : rest --ignore if already there
      insertAtCorrectPlace (KV kNew vNew) (KV k v : rest) | kNew > k = KV kNew vNew : KV k v : rest
      insertAtCorrectPlace (KV kNew vNew) (KV k v : rest) =
        KV k v : insertAtCorrectPlace (KV kNew vNew) rest
      insertAtCorrectPlace kv [] = [kv]
   in iPromiseTheseKVsAreOrdered $ insertAtCorrectPlace newKV kvs
