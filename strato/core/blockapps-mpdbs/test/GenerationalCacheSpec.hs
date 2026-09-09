module GenerationalCacheSpec (generationalCacheSpec) where

import Blockchain.Cache.Generational
import Data.Foldable (foldl')
import Test.Hspec

generationalCacheSpec :: Spec
generationalCacheSpec = describe "Blockchain.Cache.Generational" $ do
  let fill :: Int -> Int -> GenCache Int Int
      fill limit n = foldl' (\c k -> gcInsert k k c) (gcEmpty limit) [1 .. n]
      fillHM :: Int -> Int -> GenCacheHM Int Int
      fillHM limit n = foldl' (\c k -> ghInsert k k c) (ghEmpty limit) [1 .. n]

  it "never exceeds its entry limit" $ do
    gcSize (fill 100 10000) `shouldSatisfy` (<= 100)
    ghSize (fillHM 100 10000) `shouldSatisfy` (<= 100)

  it "keeps recent entries readable across one rotation" $ do
    -- Limit 100 rotates every 50 inserts; the last 50 inserts are always
    -- resident (current or previous generation).
    let c = fill 100 1000
    mapM_ (\k -> gcLookup k c `shouldBe` Just k) [951 .. 1000]
    let h = fillHM 100 1000
    mapM_ (\k -> ghLookup k h `shouldBe` Just k) [951 .. 1000]

  it "ages out entries not re-inserted for two generations" $ do
    gcLookup 1 (fill 100 1000) `shouldBe` Nothing
    ghLookup 1 (fillHM 100 1000) `shouldBe` Nothing

  it "overwrites in place without double-counting" $ do
    let h :: GenCacheHM Int Int
        h = foldl' (\c k -> ghInsert k (k + 1) c) (ghEmpty 100) (replicate 1000 7)
    ghLookup 7 h `shouldBe` Just 8
    ghSize h `shouldBe` 1

  it "deletes from both generations" $ do
    let c = gcDelete 990 (fill 100 1000)
    gcLookup 990 c `shouldBe` Nothing
    let h = ghDelete 990 (fillHM 100 1000)
    ghLookup 990 h `shouldBe` Nothing

  it "shrinks to a lowered limit as inserts continue" $ do
    let c0 = gcSetLimit 10 (fill 1000 400)
        c1 = foldl' (\c k -> gcInsert k k c) c0 [1001 .. 1020]
    gcSize c1 `shouldSatisfy` (<= 10 + 400)
    let c2 = foldl' (\c k -> gcInsert k k c) c1 [2001 .. 2100]
    gcSize c2 `shouldSatisfy` (<= 10)
