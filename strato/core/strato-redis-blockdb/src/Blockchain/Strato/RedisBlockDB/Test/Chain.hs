{-# LANGUAGE TemplateHaskell #-}

{-# OPTIONS -fno-warn-unused-top-binds #-}
{-# OPTIONS -fno-warn-missing-signatures #-}

module Blockchain.Strato.RedisBlockDB.Test.Chain where

-- import qualified Text.PrettyPrint.ANSI.Leijen as L

import Blockchain.Data.ArbitraryInstances ()
import Blockchain.Data.BlockHeader
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.Keccak256
import Control.Monad
import Data.Foldable
import Data.Maybe
import Data.Tree
import Test.QuickCheck

------------------------------------------------------------------------------

makeGenesisBlock :: IO BlockHeader
makeGenesisBlock = do
  arbitraryBlock <- generate arbitrary
  return $ arbitraryBlock {
    parentHash=unsafeCreateKeccak256FromWord256 0,
    --                   ommersHash=ommersVerificationValue [],
    number=0,
    gasUsed=0,
    nonce=42 -- this is ethereum spec!
    --                 receiptTransactions=[],
    --                 blockDataUncles=[]
    }

buildChain :: BlockHeader -> Int -> Int -> IO [BlockHeader]
buildChain seed depth maxSiblings = do
  tree <- buildTree seed depth maxSiblings
  return $ toList tree

makeNextBlock :: BlockHeader -> IO BlockHeader
makeNextBlock block = do
  let parent = blockHeaderHash block
      nextNumber = (number block) + 1
  diff <- return 1 --((blockDataDifficulty block) +) <$> (generate $ choose (1,1000))
  child <- generate arbitrary :: IO BlockHeader
  return child{
    parentHash=parent,
    difficulty=diff,
    number=nextNumber
    }

makeNextBlockIncorrectly :: BlockHeader -> IO BlockHeader
makeNextBlockIncorrectly block = do
  let parent = blockHeaderHash block
      nextNumber = (number block) + 2
  diff <- ((difficulty block) +) <$> (generate $ choose (1, 1000))
  child <- generate arbitrary :: IO BlockHeader
  return $ child {
    parentHash=parent,
    difficulty=diff,
    number=nextNumber
    }

extendChain :: Int -> [BlockHeader] -> IO [BlockHeader]
extendChain n blocks | n <= 0 = return blocks
extendChain n [] = makeGenesisBlock >>= makeNextBlock >>= (\b -> extendChain (n - 1) [b])
extendChain n blocks = blocks' >>= extendChain (n - 1)
  where
    blocks' = newBlock >>= (\b -> return (blocks ++ [b]))
    newBlock = makeNextBlock $ last blocks

extendChainIncorrectly :: Int -> [BlockHeader] -> IO [BlockHeader]
extendChainIncorrectly n blocks | n <= 0 = return blocks
extendChainIncorrectly n [] = makeGenesisBlock >>= makeNextBlockIncorrectly >>= (\b -> extendChain (n - 1) [b])
extendChainIncorrectly n blocks = blocks' >>= extendChain (n - 1)
  where
    blocks' = newBlock >>= (\b -> return (blocks ++ [b]))
    newBlock = makeNextBlockIncorrectly $ last blocks

createChain :: Int -> IO [BlockHeader]
createChain = flip extendChain []

validateLink :: BlockHeader -> BlockHeader -> Bool
validateLink parent child =
  ((blockHeaderHash parent) == (parentHash child))
    && (((number parent) + 1) == (number child))

validateChain :: [BlockHeader] -> Bool
validateChain [] = True
validateChain [_] = True
validateChain (x : xs) = (validateLink x $ head xs) && (validateChain xs)

--------------------
--                /o
--  o-o-o-o-o-o-o--o
--                \o
buildY :: BlockHeader -> Int -> Int -> IO (Tree BlockHeader)
buildY seed 0 _ = pure (Node seed [])
buildY _ _ n | n < 2 = error "fewer than 2 siblings make no sense"
buildY seed depth maxSiblings = do
  let spread = if depth == 1 then maxSiblings else 1
  nextDifficulty' <- return 1 --((blockDataDifficulty seed) +) <$> (generate $ choose (1, 1000))
  nextNumber <- return $ (number seed) + 1
  siblings <- generate $ vectorOf spread arbitrary :: IO [BlockHeader]
  withUpdates <-
    return $ fmap 
      (\sibling -> sibling{
          parentHash=blockHeaderHash seed,
          difficulty=nextDifficulty',
          number=nextNumber
          }
      ) siblings
  expanded <- forM withUpdates $ \sibling -> do
    grandchildren <- buildY sibling (depth - 1) maxSiblings
    return $ grandchildren
  return $ Node seed expanded

buildTree :: BlockHeader -> Int -> Int -> IO (Tree BlockHeader)
buildTree seed 0 _ = pure (Node seed [])
buildTree _ _ n | n < 2 = error "fewer than 2 siblings make no sense"
buildTree seed depth maxSiblings = do
  siblingCount <- generate $ invDist maxSiblings
  nextDifficulty' <- return 1 --((blockDataDifficulty seed) +) <$> (generate $ choose (1, 1000))
  nextNumber <- return $ (number seed) + 1
  siblings <- generate $ vectorOf siblingCount arbitrary :: IO [BlockHeader]
  withUpdates <-
    return $ fmap (\sibling ->
      sibling{
        parentHash=blockHeaderHash seed,
        difficulty=nextDifficulty',
        number=nextNumber
        }) siblings

  expanded <- forM (zip withUpdates ([1 ..] :: [Int])) $ \(sibling, i) -> do
    deathRate <- case i == 1 of
      True -> pure 1 :: IO Int
      False -> generate $ choose (i, depth) :: IO Int
    grandchildren <- buildTree sibling (max (depth - deathRate) 0) maxSiblings
    return $ grandchildren
  return $ Node seed expanded
  where
    invDist :: Int -> Gen Int
    invDist n = frequency [(n, choose (1, 1)), (1, choose (2, n))]

prettyTree :: (Show a) => Tree a -> Tree String
prettyTree t = show <$> t

draw' :: Tree String -> [String]
draw' (Node x ts0) = lines x ++ drawSubTrees ts0
  where
    drawSubTrees [] = []
    drawSubTrees [t] =
      "|" : shift "`- " "   " (draw' t)
    drawSubTrees (t : ts) =
      "|" : shift "+- " "|  " (draw' t) ++ drawSubTrees ts
    shift first other = zipWith (++) (first : repeat other)

bush :: BlockHeader -> Int -> Int -> IO (Tree BlockHeader)
bush g n m = do
  tree <- buildTree g n m
  if (length . leaves $ tree) < 2
    then bush g n (m + 1)
    else return tree

bushY :: BlockHeader -> Int -> Int -> IO (Tree BlockHeader)
bushY g n m = do
  tree <- buildY g n m
  if (length . leaves $ tree) < 2
    then bushY g n (m + 1)
    else return tree

leaves :: Tree a -> [a]
leaves (Node n []) = [n]
leaves (Node _ f) = concat $ map leaves f

stem :: (Eq a) => a -> Tree a -> [a]
stem l (Node n []) = if n == l then [n] else []
stem l (Node _ [t]) = (rootLabel t) : (stem l t) -- if rootLabel t == l then [rootLabel t] else stem l t
stem l (Node _ f) = concat $ map (stem l) f

stem' :: BlockHeader -> [BlockHeader] -> [BlockHeader]
stem' _ [] = error "stem' called with empty list"
stem' l (c : cs)
  | l == c = [l]
  | otherwise = l : (stem' parent (c : cs))
  where
    hsh = parentHash l
    parent = fromMaybe l (find (\b -> blockHeaderHash b == hsh) (c : cs))

showTree :: (Show a) => Tree a -> String
showTree = drawTree . prettyTree

prettyTree' :: Tree BlockHeader -> Tree String
prettyTree' tree = prettyTree $ (\x -> (number x, showHash . blockHeaderHash $ x)) <$> tree

showHash :: Keccak256 -> String
showHash = take 8 . keccak256ToHex
