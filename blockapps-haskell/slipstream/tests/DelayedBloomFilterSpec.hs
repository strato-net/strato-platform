module DelayedBloomFilterSpec where

import Control.Monad
import Data.List
import Test.Hspec

import qualified Slipstream.DelayedBloomFilter as DBF

spec :: Spec
spec = describe "DelayedBloomFilter" $ do
  it "can be created" $ do
    let f = DBF.newFilter 512 :: DBF.DelayedBloomFilter Int
    DBF.elem 900 f `shouldBe` False

  it "occupies < 2MB" $ do
    let f = DBF.newFilter 512 :: DBF.DelayedBloomFilter Int
    DBF.bitWidth f `shouldSatisfy` (< 8 * 2000000)

  it "will not answer membership until tipping point is reached" $ do
    let fs = unfoldr (\f -> Just (f, DBF.insert 17 f)) (DBF.newFilter 3)
           :: [DBF.DelayedBloomFilter Int]
    map (DBF.elem 17) (take 5 fs) `shouldBe` [False, False, False, False, True]
    let insertAndInc (n, f) = Just (f, (n+1, DBF.insert n f))
        fs2 = unfoldr insertAndInc (0 :: Int, DBF.newFilter 512)
        (empties, populated:_) = splitAt 513 fs2
    forM_ empties $ \e ->
      forM_ [0..1024] $ \n ->
        n `shouldNotSatisfy` flip DBF.elem e
    forM_ [0..512] $ \n ->
      n `shouldSatisfy` flip DBF.elem populated
  it "should have <10% false positives on 1m elements" $ do
    let f = foldr DBF.insert (DBF.newFilter 512) [1..1000000] :: DBF.DelayedBloomFilter Int
    let falsePositives = length $ filter (`DBF.elem` f) [1000000..2000000]
    falsePositives `shouldSatisfy` (< 100000)
