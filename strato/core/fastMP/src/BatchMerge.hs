{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_HADDOCK hide, prune #-}

module BatchMerge
  ( putManyKeyVal,
  )
where

import BlockApps.Logging
import qualified Blockchain.Database.MerklePatricia as MP
import qualified Blockchain.Database.MerklePatricia.Internal as MP
import qualified Blockchain.Database.MerklePatricia.NodeData as MP
import Blockchain.Strato.Model.Keccak256 (hash, keccak256ToByteString)
import Control.Monad
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Loops
import qualified Data.Bifunctor as BF
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
putManyKeyVal sr listOfInserts = do
  let listOfInserts' = map (BF.first MP.keyToSafeKey) listOfInserts

  nd <- MP.getNodeData $ MP.ptrRef sr

  finalNd <- putManyKeyVal_nodeData nd $ orderTheKVs $ map (uncurry createKV) listOfInserts'

  nr <- MP.nodeData2NodeRef finalNd

  case nr of
    Right sr' -> return sr'
    Left v -> do
      -- The whole trie is too small to fit in a level db key, just create a stateroot from the full data....
      let newSR = MP.StateRoot $ keccak256ToByteString $ hash v
      A.insert (A.Proxy @MP.NodeData) newSR finalNd
      return newSR

splitKeysByPrefix :: [Maybe N.Nibble] -> [KV] -> [[KV]]
splitKeysByPrefix [] [] = []
splitKeysByPrefix [] _ = error "in call to splitKeysByPrefix, keys are out of order"
splitKeysByPrefix (firstChar : remainingPrefix) kvs =
  let (matched, remaining) = span ((== firstChar) . listToMaybe . theKey) kvs
   in case firstChar of
        Just _ -> map (\(KV k v) -> (KV (tail k) v)) matched : splitKeysByPrefix remainingPrefix remaining
        Nothing -> matched : splitKeysByPrefix remainingPrefix remaining

putManyKeyVal_nodeData ::
  (MonadLogger m, (MP.StateRoot `A.Alters` MP.NodeData) m) =>
  MP.NodeData ->
  ReverseOrderedKVs ->
  m MP.NodeData
putManyKeyVal_nodeData (MP.FullNodeData choices val) listOfInserts = do
  let kvsSplitByFirstNibble = splitKeysByPrefix (map Just [15, 14 .. 0] ++ [Nothing]) $ getTheKVs listOfInserts

  choices' <-
    forM (zip kvsSplitByFirstNibble $ reverse choices) $ \(newVals, oldVal) -> do
      if null newVals
        then return oldVal
        else do
          oldNd <- MP.getNodeData oldVal
          nd <- putManyKeyVal_nodeData oldNd $ iPromiseTheseKVsAreOrdered newVals
          MP.nodeData2NodeRef nd

  let val' =
        case last kvsSplitByFirstNibble of
          [] -> val
          [KV _ (Right x)] -> Just x
          x -> error $ "internal error: forbidden pattern match in call to putManyKeyVal_nodeData: " ++ show x

  return $ MP.FullNodeData (reverse choices') val'
putManyKeyVal_nodeData (MP.ShortcutNodeData k (Right v)) listOfInserts = do
  createMPFast_NodeData $ insertKV_ignoreIfExists listOfInserts $ KV (N.unpack k) $ Right v
putManyKeyVal_nodeData (nd@(MP.ShortcutNodeData _ (Left _))) listOfInserts = do
  --OK, this case should be extrememly rare (since keys are always randomized by a hash function anyway).
  --This is both theoretically obvious, and seems to be empirically true in the times I have
  --already run things (this case hasn't been triggered yet).
  --Also, filling in this case properly will be a bit tricky....  new keys could have the same
  --prefix given in the ShortcutNodeData, or part of it, or none at all.  All three of these will
  --involve very different results.
  --Since this is difficult and rare, I am going to just default to slow one-by-one inserts for
  --now....

  -- concatM (map (\(KV k (Right v)) -> MP.putKV_NodeData (N.pack k) v) $ getTheKVs listOfInserts) nd
  concatM
    ( map
        ( \(KV k v) -> case v of
            Right v' -> MP.putKV_NodeData (N.pack k) v'
            Left _ -> error "Unsupported case: KV with Left value"
        )
        $ getTheKVs listOfInserts
    )
    nd
putManyKeyVal_nodeData MP.EmptyNodeData listOfInserts = do
  createMPFast_NodeData listOfInserts

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
