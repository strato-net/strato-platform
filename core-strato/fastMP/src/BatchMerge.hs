
module BatchMerge (
  putManyKeyVal
  ) where

import           Control.Monad.IO.Class
--import           Control.Monad.Loops
import qualified Data.ByteString.Base16 as B16
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

  sr <- putManyKeyVal_nodeData mpdb nd listOfInserts'

  return mpdb{MP.stateRoot=sr}
  
  
{-  
  concatM (map (flip putRawStorageKeyValDB) listOfInserts) mpdb

putRawStorageKeyValDB :: MonadIO m =>
                         MP.MPDB -> (MP.Key, MP.Val) -> m MP.MPDB
putRawStorageKeyValDB mpdb (key, val) = do
  MP.putKeyVal mpdb key val
-}

putManyKeyVal_nodeData :: MonadIO m=>
                          MP.MPDB -> MP.NodeData -> [(MP.Key, MP.Val)] -> m MP.StateRoot
putManyKeyVal_nodeData mpdb (MP.FullNodeData _ _) listOfInserts = do
  _ <- error "putManyKeyVal_nodeData: undefined fullnode"
  undefined mpdb listOfInserts
putManyKeyVal_nodeData mpdb (MP.ShortcutNodeData _ _) listOfInserts = do
  _ <- error "putManyKeyVal_nodeData: undefined shortnode"
  undefined mpdb listOfInserts
putManyKeyVal_nodeData mpdb MP.EmptyNodeData listOfInserts = do
  liftIO $ createMPFast (MP.ldb mpdb) $ orderTheKVs $ map (uncurry createKV) listOfInserts


createKV :: MP.Key -> MP.Val -> KV
createKV (N.EvenNibbleString k) v = KV (B16.encode k) $ Right v
createKV _ _ = error "createKV only supports even nibblestrings at the moment"
