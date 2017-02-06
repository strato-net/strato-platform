{-# LANGUAGE TemplateHaskell #-}
{-# OPTIONS -fno-warn-unused-top-binds #-}
{-# OPTIONS -fno-warn-missing-signatures #-}

module TestChain where

import           Control.Monad
import           Test.QuickCheck
import           Lens.Family2
import           Lens.Family2.TH

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
