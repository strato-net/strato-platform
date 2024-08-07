module Blockchain.Sequencer.ChainHelpers where

import Blockchain.Data.BlockHeader
import Blockchain.Sequencer.Event
import Blockchain.Strato.Model.Keccak256
import Blockchain.Verification (ommersVerificationValue)
import Control.Monad
import Test.QuickCheck

-- todo should genesis block make somebody exceptionally wealthy?
makeGenesisBlock :: IO IngestBlock
makeGenesisBlock = do
  startBlock <-
    ( (setIngestBlockParentHash (unsafeCreateKeccak256FromWord256 . fromIntegral $ (0 :: Int)))
        . (setIngestBlockUnclesHash (ommersVerificationValue []))
        . (setIngestBlockNumber 0)
        . (setIngestBlockGasUsed 0)
        . (setIngestBlockNonce 42) -- this is ethereum spec!
      )
      <$> generate arbitrary
  return $ startBlock {ibReceiptTransactions = [], ibBlockUncles = []}

buildIngestChain :: IngestBlock -> Int -> Int -> IO [IngestBlock]
buildIngestChain _ 0 _ = return []
buildIngestChain seed depth maxSiblings = do
  siblingCount <- generate $ choose (1, maxSiblings)
  nextDifficulty <- return 1 --((ingestBlockDifficulty seed) +) <$> (generate $ choose (1, 1000)) -- difficulty bomb
  nextNumber <- return $ (ingestBlockNumber seed) + 1
  siblings <- generate $ vectorOf siblingCount arbitrary
  withUpdates <-
    return $
      ( (setIngestBlockParentHash . ingestBlockHash $ seed)
          . (setIngestBlockDifficulty nextDifficulty)
          . (setIngestBlockNumber nextNumber)
      )
        <$> siblings
  expanded <- forM withUpdates $ \sibling -> do
    grandchildren <- buildIngestChain sibling (depth - 1) maxSiblings
    return $ sibling : grandchildren
  return . join $ expanded

mapIngestHeader :: (BlockHeader -> BlockHeader) -> IngestBlock -> IngestBlock
mapIngestHeader f baseBlock = baseBlock {ibBlockData = (f . ibBlockData $ baseBlock)}

setIngestBlockParentHash :: Keccak256 -> IngestBlock -> IngestBlock
setIngestBlockParentHash hash' = mapIngestHeader $ \h -> h {parentHash = hash'}

setIngestBlockUnclesHash :: Keccak256 -> IngestBlock -> IngestBlock
setIngestBlockUnclesHash hash' = mapIngestHeader $ \h -> h {ommersHash = hash'}

setIngestBlockDifficulty :: Integer -> IngestBlock -> IngestBlock
setIngestBlockDifficulty diff = mapIngestHeader $ \h -> h {difficulty = diff}

ingestBlockNumber :: IngestBlock -> Integer
ingestBlockNumber = number . ibBlockData

setIngestBlockNumber :: Integer -> IngestBlock -> IngestBlock
setIngestBlockNumber number' = mapIngestHeader $ \h -> h {number = number'}

setIngestBlockGasUsed :: Integer -> IngestBlock -> IngestBlock
setIngestBlockGasUsed amount = mapIngestHeader $ \h -> h {gasUsed = amount}

setIngestBlockNonce :: Integer -> IngestBlock -> IngestBlock
setIngestBlockNonce val = mapIngestHeader $ \h -> h {nonce = fromIntegral val}
