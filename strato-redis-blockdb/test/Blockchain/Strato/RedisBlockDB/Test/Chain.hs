{-# LANGUAGE TemplateHaskell #-}
{-# OPTIONS -fno-warn-unused-top-binds #-}
{-# OPTIONS -fno-warn-missing-signatures #-}

module Blockchain.Strato.RedisBlockDB.Test.Chain where

import           Control.Monad
import           Test.QuickCheck
import           Lens.Family2
import           Lens.Family2.TH
import           Data.List
import           Data.Tree
import           Numeric

import           Blockchain.Data.BlockDB
import           Blockchain.Data.ArbitraryInstances()
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
buildChain _    0     _           = return []
buildChain seed depth maxSiblings = do
    siblingCount    <- generate $ choose (1, maxSiblings)
    nextDifficulty' <- ((blockDataDifficulty seed) +) <$> (generate $ choose (1, 1000)) -- difficulty bomb
    nextNumber      <- return $ (blockDataNumber seed) + 1
    siblings        <- generate $ vectorOf siblingCount arbitrary :: IO [BlockData]
    withUpdates     <- return $ ( (over _blockDataParentHash      (const . blockHeaderHash $ seed))
                                . (over _blockDataDifficulty      (const nextDifficulty'))
                                . (over _blockDataNumber          (const nextNumber))
                                )
                               <$> siblings
    expanded        <- forM withUpdates $ \sibling -> do
                           grandchildren <- buildChain sibling (depth - 1) maxSiblings
                           return $ sibling : grandchildren
    return $ seed : join expanded

buildTree :: BlockData -> Int -> Int -> IO (Tree BlockData)
buildTree seed 0     _           = pure (Node seed []) 
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

invDist :: Int -> Gen Int
invDist n = frequency [(n*n, choose (1, 1)), (1, choose (1, n))]

prettyTree :: (Show a) => Tree a -> Tree String
prettyTree t = show <$> t

showTree :: (Show a) => Tree a -> String
showTree = drawTree . prettyTree

prettyTree' :: Tree BlockData -> Tree String
prettyTree' tree = prettyTree $ (\x -> (blockDataNumber x, showHash . blockHeaderHash $ x)) <$> tree

showHash :: SHA -> String
showHash (SHA h) = take 8 $ showHex h ""
