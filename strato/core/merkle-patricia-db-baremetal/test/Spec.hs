{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE PackageImports #-}

module Main where

import qualified "fastMP" BatchMerge as HSBatch
import qualified "merkle-patricia-db-baremetal" BatchMerge as CBatch
import BlockApps.Logging (runNoLoggingT)
import Blockchain.Data.RLP
import "merkle-patricia-db" Blockchain.Database.MerklePatricia as HS
import qualified "merkle-patricia-db-baremetal" Blockchain.Database.MerklePatricia as C
import qualified Blockchain.Database.MerklePatriciaNative as N
import Control.Exception (bracket)
import Control.Monad (foldM, forM)
import Control.Monad.IO.Class (liftIO)
import qualified Data.ByteString as B
import qualified Data.NibbleString as Nib
import qualified Database.LevelDB.Base as DB
import Database.LevelDB.Internal (DB (..))
import Foreign.Ptr (castPtr)
import System.Directory (removePathForcibly)
import Test.Hspec

main :: IO ()
main = hspec $ do
  describe "C trie vs Haskell trie (in-memory store)" $ do
    it "single put produces matching state root" $ do
      let kv = (key 0x01, rlpEncode ("hello" :: B.ByteString))
      hsRoot <- hsPuts [kv]
      cRoot <- withMemoryStore $ cPuts [kv]
      cRoot `shouldBe` hsRoot

    it "sequential puts match" $ do
      hsRoot <- hsPuts kvs
      cRoot <- withMemoryStore $ cPuts kvs
      cRoot `shouldBe` hsRoot

    it "batch put matches Haskell batch merge" $ do
      hsRoot <- runNoLoggingT $ runMP $ HSBatch.putManyKeyVal emptyTriePtr kvs
      cRoot <- withMemoryStore $ runNoLoggingT $ runMP $ CBatch.putManyKeyVal emptyTriePtr kvs
      cRoot `shouldBe` hsRoot

    it "batch reports existing keys" $ do
      (_, existed) <- withMemoryStore $ runNoLoggingT $ runMP $ do
        sr <- CBatch.putManyKeyVal emptyTriePtr (take 3 kvs)
        CBatch.putManyKeyValExisted sr (take 5 kvs)
      existed `shouldBe` map fst (take 3 kvs)

    it "get retrieves inserted values and misses absent ones" $ do
      (hits, miss) <- withMemoryStore $ runMP $ do
        sr <- foldM (\s (k, v) -> C.putKeyVal s k v) emptyTriePtr kvs
        hits <- forM kvs $ \(k, _) -> C.getKeyVal sr k
        miss <- C.getKeyVal sr (key 0xFF)
        return (hits, miss)
      hits `shouldBe` map (Just . snd) kvs
      miss `shouldBe` Nothing

    it "delete matches Haskell" $ do
      hsRoot <- runMP $ do
        sr <- foldM (\s (k, v) -> HS.putKeyVal s k v) emptyTriePtr kvs
        HS.deleteKey sr (fst (kvs !! 4))
      cRoot <- withMemoryStore $ runMP $ do
        sr <- foldM (\s (k, v) -> C.putKeyVal s k v) emptyTriePtr kvs
        C.deleteKey sr (fst (kvs !! 4))
      cRoot `shouldBe` hsRoot

    it "putKeyValExisted reports existed correctly" $ do
      (ex1, ex2) <- withMemoryStore $ runMP $ do
        (sr1, e1) <- C.putKeyValExisted emptyTriePtr (key 0x01) (rlpEncode (1 :: Integer))
        (_, e2) <- C.putKeyValExisted sr1 (key 0x01) (rlpEncode (2 :: Integer))
        return (e1, e2)
      (ex1, ex2) `shouldBe` (False, True)

  describe "C store over LevelDB" $ do
    it "nodes survive flush, close and a cold reopen" $ do
      let dir = "/tmp/merkle-patricia-db-baremetal-test-ldb"
      removePathForcibly dir
      DB.withDB dir DB.defaultOptions {DB.createIfMissing = True} $ \db -> do
        -- tiny cache so eviction happens while writing
        root <- bracket (openOn db 50 2) N.close $ \h -> do
          N.setActiveHandle (Just h)
          root <- runNoLoggingT $ runMP $ foldM (\s chunk -> CBatch.putManyKeyVal s chunk <* liftIO (N.tick h)) emptyTriePtr (chunks 100 manyKvs)
          N.flush h
          N.setActiveHandle Nothing
          return root
        hsRoot <- runNoLoggingT $ runMP $ HSBatch.putManyKeyVal emptyTriePtr manyKvs
        root `shouldBe` hsRoot
        -- fresh store, empty cache: every node must come from LevelDB
        vals <- bracket (openOn db 50 2) N.close $ \h -> do
          N.setActiveHandle (Just h)
          vs <- runMP $ forM manyKvs $ \(k, _) -> C.getKeyVal root k
          N.setActiveHandle Nothing
          return vs
        vals `shouldBe` map (Just . snd) manyKvs
  where
    key b = Nib.EvenNibbleString (B.replicate 32 b)
    kvs = [(Nib.EvenNibbleString (B.pack (fromIntegral i : replicate 31 0)), rlpEncode (fromIntegral i :: Integer)) | i <- [1 .. 10 :: Int]]
    manyKvs = [(Nib.EvenNibbleString (B.pack [fromIntegral (i `div` 256), fromIntegral i] <> B.replicate 30 0), rlpEncode (fromIntegral i :: Integer)) | i <- [1 .. 1000 :: Int]]
    chunks n xs = case splitAt n xs of
      (a, []) -> [a]
      (a, b) -> a : chunks n b
    hsPuts = runMP . foldM (\s (k, v) -> HS.putKeyVal s k v) emptyTriePtr
    cPuts = runMP . foldM (\s (k, v) -> C.putKeyVal s k v) emptyTriePtr
    openOn (DB ptr _ _) cap every = N.openLevelDB (castPtr ptr) cap every

withMemoryStore :: IO a -> IO a
withMemoryStore act = bracket N.openMemory N.close $ \h -> do
  N.setActiveHandle (Just h)
  r <- act
  N.setActiveHandle Nothing
  return r
