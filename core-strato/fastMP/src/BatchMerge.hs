
module BatchMerge (
  putManyKeyVal
  ) where

import           Control.Monad.IO.Class
--import           Control.Monad.Loops
import qualified Data.NibbleString as N

import qualified Blockchain.Database.MerklePatricia as MP
import qualified Blockchain.Database.MerklePatricia.Internal as MP
import qualified Blockchain.Database.MerklePatricia.NodeData as MP

import FastMP
import KV
import ReverseOrderedKVs

putManyKeyVal :: MonadIO m=>
                 MP.MPDB -> [(MP.Key, MP.Val)] -> m MP.MPDB
putManyKeyVal mpdb listOfInserts = do
  let listOfInserts' = map (\(k, v) -> (MP.keyToSafeKey k, v)) listOfInserts
  nd <- MP.getNodeData mpdb (MP.PtrRef $ MP.stateRoot mpdb)

  sr <- putManyKeyVal_nodeData mpdb nd $ orderTheKVs $ map (uncurry createKV) listOfInserts'

  return mpdb{MP.stateRoot=sr}
  
  
{-  
  concatM (map (flip putRawStorageKeyValDB) listOfInserts) mpdb

putRawStorageKeyValDB :: MonadIO m =>
                         MP.MPDB -> (MP.Key, MP.Val) -> m MP.MPDB
putRawStorageKeyValDB mpdb (key, val) = do
  MP.putKeyVal mpdb key val
-}

putManyKeyVal_nodeData :: MonadIO m=>
                          MP.MPDB -> MP.NodeData -> ReverseOrderedKVs -> m MP.StateRoot
putManyKeyVal_nodeData mpdb (n@(MP.FullNodeData _ _)) listOfInserts = do
  _ <- error $ "putManyKeyVal_nodeData: undefined fullnode: " ++ show listOfInserts ++ "\n" ++ show n
  undefined mpdb listOfInserts



  
putManyKeyVal_nodeData mpdb (MP.ShortcutNodeData k (Right v)) listOfInserts = do
   liftIO $ createMPFast (MP.ldb mpdb) $ insertKV_ignoreIfExists listOfInserts $ KV (N.unpack k) $ Right v


putManyKeyVal_nodeData mpdb (n@(MP.ShortcutNodeData _ _)) listOfInserts = do
  _ <- error $ "putManyKeyVal_nodeData(value is left): undefined shortnode: " ++ show listOfInserts ++ "\n" ++ show n
  undefined mpdb listOfInserts

  

  
putManyKeyVal_nodeData mpdb MP.EmptyNodeData listOfInserts = do
  liftIO $ createMPFast (MP.ldb mpdb) listOfInserts


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
