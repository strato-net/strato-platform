module Blockchain.Sequencer.ChainHelpers where

import           Blockchain.Data.DataDefs
import           Blockchain.Sequencer.Event
import           Blockchain.SHA

import           Blockchain.Verification                 (ommersVerificationValue)

import           Control.Monad

import           Test.QuickCheck

-- todo should genesis block make somebody exceptionally wealthy?
makeGenesisBlock :: IO IngestBlock
makeGenesisBlock = do
    startBlock <-  ( (setIngestBlockParentHash (SHA . fromIntegral $ (0 :: Int)))
                   . (setIngestBlockUnclesHash (ommersVerificationValue []))
                   . (setIngestBlockNumber 0)
                   . (setIngestBlockGasUsed 0)
                   . (setIngestBlockNonce 42) -- this is ethereum spec!
                   ) <$> generate arbitrary
    return $ startBlock { ibReceiptTransactions = [], ibBlockUncles = [] }

buildIngestChain :: IngestBlock -> Int -> Int -> IO [IngestBlock]
buildIngestChain _    0     _           = return []
buildIngestChain seed depth maxSiblings = do
    siblingCount   <- generate $ choose (1, maxSiblings)
    nextDifficulty <- ((ingestBlockDifficulty seed) +) <$> (generate $ choose (1, 1000)) -- difficulty bomb
    nextNumber     <- return $ (ingestBlockNumber seed) + 1
    siblings       <- generate $ vectorOf siblingCount arbitrary
    withUpdates    <- return $ ( (setIngestBlockParentHash . ingestBlockHash $ seed)
                               . (setIngestBlockDifficulty nextDifficulty)
                               . (setIngestBlockNumber nextNumber)
                               )
                              <$> siblings
    expanded       <- forM withUpdates $ \sibling -> do
                          grandchildren <- buildIngestChain sibling (depth - 1) maxSiblings
                          return $ sibling : grandchildren
    return . join $ expanded

mapIngestHeader :: (BlockData -> BlockData) -> IngestBlock -> IngestBlock
mapIngestHeader f baseBlock = baseBlock { ibBlockData = (f . ibBlockData $ baseBlock) }

setIngestBlockParentHash :: SHA -> IngestBlock -> IngestBlock
setIngestBlockParentHash hash' = mapIngestHeader $ \h -> h { blockDataParentHash = hash'}

setIngestBlockUnclesHash :: SHA -> IngestBlock -> IngestBlock
setIngestBlockUnclesHash hash' = mapIngestHeader $ \h -> h { blockDataUnclesHash = hash'}

setIngestBlockDifficulty :: Integer -> IngestBlock -> IngestBlock
setIngestBlockDifficulty diff = mapIngestHeader $ \h -> h { blockDataDifficulty = diff }

ingestBlockNumber :: IngestBlock -> Integer
ingestBlockNumber = blockDataNumber . ibBlockData

setIngestBlockNumber :: Integer -> IngestBlock -> IngestBlock
setIngestBlockNumber number = mapIngestHeader $ \h -> h { blockDataNumber = number }

setIngestBlockGasUsed :: Integer -> IngestBlock -> IngestBlock
setIngestBlockGasUsed amount = mapIngestHeader $ \h -> h { blockDataGasUsed = amount }

setIngestBlockNonce :: Integer -> IngestBlock -> IngestBlock
setIngestBlockNonce val = mapIngestHeader $ \h -> h { blockDataNonce = fromIntegral val }

extractBlocksFromOutputEvents :: [OutputEvent] -> [OutputBlock]
extractBlocksFromOutputEvents = join . (map convert)
    where convert (OETx _ _)  = []
          convert (OEBlock b) = [b]
          convert _           = error "partial function inf extractBlocksFromOutputEvents"

extractTxsFromOutputEvents :: [OutputEvent] -> [OutputTx]
extractTxsFromOutputEvents = join . (map convert)
    where convert (OETx _ t)  = [t]
          convert (OEBlock _) = []
          convert _           = error "partial function in extractTxsFromOutputEvents"
