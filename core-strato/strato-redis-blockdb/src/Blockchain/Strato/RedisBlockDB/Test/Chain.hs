{-# LANGUAGE TemplateHaskell #-}
{-# OPTIONS -fno-warn-unused-top-binds #-}
{-# OPTIONS -fno-warn-missing-signatures #-}

module Blockchain.Strato.RedisBlockDB.Test.Chain where

import           Control.Monad
import           Data.Foldable
import           Data.Maybe
import           Data.Tree
import           Lens.Family2
import           Lens.Family2.TH
import           Test.QuickCheck
-- import qualified Text.PrettyPrint.ANSI.Leijen as L

import           Blockchain.Data.ArbitraryInstances ()
import           Blockchain.Data.BlockDB
import           Blockchain.Strato.Model.SHA

------------------------------------------------------------------------------
-- Lenses
--
$(makeLensesBy (\n -> Just ("_" ++ n)) ''BlockData)
$(makeLensesBy (\n -> Just ("_" ++ n)) ''Block)

makeGenesisBlock :: IO BlockData
makeGenesisBlock = do
    startBlock <-  ( (over _blockDataParentHash (const . SHA $ 0))
--                   . (over _blockDataUnclesHash (const (ommersVerificationValue [])))
                   . (over _blockDataNumber     (const 0))
                   . (over _blockDataGasUsed    (const 0))
                   . (over _blockDataNonce      (const 42)) -- this is ethereum spec!
--                   . (over _blockDataReceiptTransactions (const []))
--                   . (over _blockDataUncles              (const []))
                   ) <$> generate arbitrary
    return $ startBlock

buildChain :: BlockData -> Int -> Int -> IO [BlockData]
buildChain seed depth maxSiblings = do
    tree <- buildTree seed depth maxSiblings
    return $ toList tree

makeNextBlock :: BlockData -> IO BlockData
makeNextBlock block = do
  let
    parent = blockHeaderHash block
    nextNumber = (blockDataNumber block) + 1
  diff <- ((blockDataDifficulty block) +) <$> (generate $ choose (1,1000))
  child <- generate arbitrary :: IO BlockData
  return $ ( (over _blockDataParentHash (const parent))
            . (over _blockDataDifficulty (const diff))
            . (over _blockDataNumber     (const nextNumber))
            ) child

makeNextBlockIncorrectly :: BlockData -> IO BlockData
makeNextBlockIncorrectly block = do
  let
    parent = blockHeaderHash block
    nextNumber = (blockDataNumber block) + 2
  diff <- ((blockDataDifficulty block) +) <$> (generate $ choose (1,1000))
  child <- generate arbitrary :: IO BlockData
  return $ ( (over _blockDataParentHash (const parent))
            . (over _blockDataDifficulty (const diff))
            . (over _blockDataNumber     (const nextNumber))
            ) child

extendChain :: Int -> [BlockData] -> IO [BlockData]
extendChain n blocks | n <= 0 = return blocks
extendChain n [] = makeGenesisBlock >>= makeNextBlock >>= (\b -> extendChain (n-1) [b])
extendChain n blocks = blocks' >>= extendChain (n-1)
  where
    blocks' = newBlock >>= (\b -> return (blocks ++ [b]))
    newBlock = makeNextBlock $ last blocks

extendChainIncorrectly :: Int -> [BlockData] -> IO [BlockData]
extendChainIncorrectly n blocks | n <= 0 = return blocks
extendChainIncorrectly n [] = makeGenesisBlock >>= makeNextBlockIncorrectly >>= (\b -> extendChain (n-1) [b])
extendChainIncorrectly n blocks = blocks' >>= extendChain (n-1)
  where
    blocks' = newBlock >>= (\b -> return (blocks ++ [b]))
    newBlock = makeNextBlockIncorrectly $ last blocks

createChain :: Int -> IO [BlockData]
createChain = flip extendChain []

validateLink :: BlockData -> BlockData -> Bool
validateLink parent child =
  ((blockHeaderHash parent) == (blockDataParentHash child))
  &&
  (((blockDataNumber parent) + 1) == (blockDataNumber child))

validateChain :: [BlockData] -> Bool
validateChain [] = True
validateChain [_] = True
validateChain (x:xs) = (validateLink x $ head xs) && (validateChain xs)

--------------------
--                /o
--  o-o-o-o-o-o-o--o
--                \o
buildY :: BlockData -> Int -> Int -> IO (Tree BlockData)
buildY seed 0     _           = pure (Node seed [])
buildY _    _     n | n < 2   = error "fewer than 2 siblings make no sense"
buildY seed depth maxSiblings = do
    let spread = if depth == 1 then maxSiblings else 1
    nextDifficulty' <- ((blockDataDifficulty seed) +) <$> (generate $ choose (1, 1000))
    nextNumber      <- return $ (blockDataNumber seed) + 1
    siblings        <- generate $ vectorOf spread arbitrary :: IO [BlockData]
    withUpdates     <- return $ ( (over _blockDataParentHash      (const . blockHeaderHash $ seed))
                                . (over _blockDataDifficulty      (const nextDifficulty'))
                                . (over _blockDataNumber          (const nextNumber))
                                )
                               <$> siblings
    expanded        <- forM withUpdates $ \sibling -> do
                           grandchildren <- buildY sibling (depth - 1) maxSiblings
                           return $ grandchildren
    return $ Node seed expanded

buildTree :: BlockData -> Int -> Int -> IO (Tree BlockData)
buildTree seed 0     _           = pure (Node seed [])
buildTree _    _     n | n < 2   = error "fewer than 2 siblings make no sense"
buildTree seed depth maxSiblings = do
    siblingCount    <- generate $ invDist maxSiblings
    nextDifficulty' <- ((blockDataDifficulty seed) +) <$> (generate $ choose (1, 1000))
    nextNumber      <- return $ (blockDataNumber seed) + 1
    siblings        <- generate $ vectorOf siblingCount arbitrary :: IO [BlockData]
    withUpdates     <- return $ ( (over _blockDataParentHash      (const . blockHeaderHash $ seed))
                                . (over _blockDataDifficulty      (const nextDifficulty'))
                                . (over _blockDataNumber          (const nextNumber))
                                )
                               <$> siblings
    expanded        <- forM (zip withUpdates ([1..]::[Int]) ) $ \(sibling, i) -> do
                           deathRate <- case i == 1 of
                               True  -> pure 1 :: IO Int
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
        drawSubTrees (t:ts) =
            "|" : shift "+- " "|  " (draw' t) ++ drawSubTrees ts
        shift first other = zipWith (++) (first : repeat other)

bush :: BlockData -> Int -> Int -> IO (Tree BlockData)
bush g n m = do
    tree <- buildTree g n m
    if (length . leaves $ tree) < 2
    then bush g n (m + 1)
    else return tree

bushY :: BlockData -> Int -> Int -> IO (Tree BlockData)
bushY g n m = do
    tree <- buildY g n m
    if (length . leaves $ tree) < 2
    then bushY g n (m + 1)
    else return tree

leaves :: Tree a -> [a]
leaves (Node n []) = [n]
leaves (Node _ f)  = concat $ map leaves f

stem :: (Eq a) => a -> Tree a -> [a]
stem l (Node n [])  = if n == l then [n] else []
stem l (Node _ [t]) = (rootLabel t):(stem l t) -- if rootLabel t == l then [rootLabel t] else stem l t
stem l (Node _ f)   = concat $ map (stem l) f

stem' :: BlockData -> [BlockData] -> [BlockData]
stem' _ []                  = error "stem' called with empty list"
stem' l (c:cs) | l == c     = [l]
               | otherwise  = l:(stem' parent (c:cs))
    where
        hsh = blockDataParentHash l
        parent = fromMaybe l (find (\b -> blockHeaderHash b == hsh) (c:cs))

showTree :: (Show a) => Tree a -> String
showTree = drawTree . prettyTree

showTree' :: (Show a) => Tree a -> Tree a -> String
showTree' = undefined

prettyTree' :: Tree BlockData -> Tree String
prettyTree' tree = prettyTree $ (\x -> (blockDataNumber x, showHash . blockHeaderHash $ x)) <$> tree

showHash :: SHA -> String
showHash = take 8 . shaToHex
