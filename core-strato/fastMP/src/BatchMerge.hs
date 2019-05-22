
module BatchMerge (
  putManyKeyVal
  ) where

import           Control.Monad
import           Control.Monad.IO.Class
import           Control.Monad.Loops
import           Data.Default
import           Data.Maybe
import qualified Data.NibbleString as N
import qualified Database.LevelDB                             as DB

import qualified Blockchain.Database.MerklePatricia as MP
import qualified Blockchain.Database.MerklePatricia.Internal as MP
import qualified Blockchain.Database.MerklePatricia.NodeData as MP
import           Blockchain.Strato.Model.SHA                  (keccak256)

import FastMP
import KV
import ReverseOrderedKVs

putManyKeyVal :: MonadIO m=>
                 MP.MPDB -> [(MP.Key, MP.Val)] -> m MP.MPDB
putManyKeyVal mpdb listOfInserts = do
  let listOfInserts' = map (\(k, v) -> (MP.keyToSafeKey k, v)) listOfInserts

  nd <- MP.getNodeData mpdb (MP.PtrRef $ MP.stateRoot mpdb)

  finalNd <- putManyKeyVal_nodeData mpdb nd $ orderTheKVs $ map (uncurry createKV) listOfInserts'

  nr <- MP.nodeData2NodeRef mpdb finalNd

  case nr of
    MP.PtrRef sr -> return mpdb{MP.stateRoot=sr}
    MP.SmallRef v -> do -- The whole trie is too small to fit in a level db key, just create a stateroot from the full data....
      let newSR = keccak256 v
      DB.put (MP.ldb mpdb) def newSR v
      return mpdb{MP.stateRoot=MP.StateRoot newSR}

splitKeysByPrefix :: [Maybe N.Nibble] -> [KV] -> [[KV]]
splitKeysByPrefix [] [] = []
splitKeysByPrefix [] _ = error "in call to splitKeysByPrefix, keys are out of order"
splitKeysByPrefix (firstChar:remainingPrefix) kvs =
  let (matched, remaining) = span ((== firstChar) . listToMaybe . theKey) kvs
  in case firstChar of
       Just _ -> map (\(KV k v) -> (KV (tail k) v)) matched:splitKeysByPrefix remainingPrefix remaining
       Nothing -> matched:splitKeysByPrefix remainingPrefix remaining

putManyKeyVal_nodeData :: MonadIO m=>
                          MP.MPDB -> MP.NodeData -> ReverseOrderedKVs -> m MP.NodeData
putManyKeyVal_nodeData mpdb (MP.FullNodeData choices val) listOfInserts = do
  let kvsSplitByFirstNibble = splitKeysByPrefix (map Just [15,14..0] ++ [Nothing]) $ getTheKVs listOfInserts
  
  choices' <-
    forM (zip kvsSplitByFirstNibble $ reverse choices) $ \(newVals, oldVal) -> do
      if null newVals
        then return oldVal
        else do
          oldNd <- MP.getNodeData mpdb oldVal
          nd <- putManyKeyVal_nodeData mpdb oldNd $ iPromiseTheseKVsAreOrdered newVals
          MP.nodeData2NodeRef mpdb nd

  let val' =
        case last kvsSplitByFirstNibble of
          [] -> val
          [KV _ (Right x)] -> Just x
          x -> error $ "internal error: forbidden pattern match in call to putManyKeyVal_nodeData: " ++ show x
              
  return $ MP.FullNodeData (reverse choices') val'



  
putManyKeyVal_nodeData mpdb (MP.ShortcutNodeData k (Right v)) listOfInserts = do
   liftIO $ createMPFast_NodeData (MP.ldb mpdb) $ insertKV_ignoreIfExists listOfInserts $ KV (N.unpack k) $ Right v


putManyKeyVal_nodeData mpdb (nd@(MP.ShortcutNodeData _ (Left _))) listOfInserts = do
  --OK, this case should be extrememly rare (since keys are always randomized by a hash function anyway).
  --This is both theoretically obvious, and seems to be empirically true in the times I have
  --already run things (this case hasn't been triggered yet).
  --Also, filling in this case properly will be a bit tricky....  new keys could have the same
  --prefix given in the ShortcutNodeData, or part of it, or none at all.  All three of these will
  --involve very different results.
  --Since this is difficult and rare, I am going to just default to slow one-by-one inserts for
  --now....

  
  concatM (map (\(KV k (Right v)) -> MP.putKV_NodeData mpdb (N.pack k) v) $ getTheKVs listOfInserts) nd




  

  
putManyKeyVal_nodeData mpdb MP.EmptyNodeData listOfInserts = do
  liftIO $ createMPFast_NodeData (MP.ldb mpdb) listOfInserts


createKV :: MP.Key -> MP.Val -> KV
createKV k v = KV (N.unpack k) $ Right v

insertKV_ignoreIfExists :: ReverseOrderedKVs -> KV -> ReverseOrderedKVs
insertKV_ignoreIfExists reverseOrderedKVs newKV =
  let kvs = getTheKVs reverseOrderedKVs
      insertAtCorrectPlace :: KV -> [KV] -> [KV]
      insertAtCorrectPlace (KV kNew _) (KV k v:rest) | kNew == k  = KV k v:rest --ignore if already there
      insertAtCorrectPlace (KV kNew vNew) (KV k v:rest) | kNew > k  = KV kNew vNew:KV k v:rest
      insertAtCorrectPlace (KV kNew vNew) (KV k v:rest)  =
        KV k v:insertAtCorrectPlace (KV kNew vNew) rest
      insertAtCorrectPlace kv []  = [kv]
  in iPromiseTheseKVsAreOrdered $ insertAtCorrectPlace newKV kvs
