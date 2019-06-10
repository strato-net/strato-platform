{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE GADTs                 #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE ScopedTypeVariables   #-}
{-# LANGUAGE TypeApplications      #-}
{-# LANGUAGE TypeFamilies          #-}
{-# OPTIONS_GHC -fno-warn-orphans  #-}


module Blockchain.Data.BlockDB (
  Block(..),
  BlockData(..),
  blockHash,
  blockHeaderHash,
  blockHeaderPartialHash,
  getBlock,
  putBlocks,
  nextDifficulty,
  homesteadNextDifficulty,
  createBlockFromHeaderAndBody
) where

import qualified Database.Esqueleto                 as E
import           Database.Persist                   hiding (get)
import qualified Database.Persist.Postgresql        as SQL

import           Data.Bits
import qualified Data.ByteString                    as B
import qualified Data.ByteString.Base16             as B16
import qualified Data.ByteString.Char8              as BC

import           Data.List
import qualified Data.Map                           as M
import           Data.Maybe
import qualified Data.Set                           as S

import           Data.Time.Clock
import           Data.Time.Clock.POSIX

import           Numeric
import           Text.PrettyPrint.ANSI.Leijen       hiding ((<$>))


import           Control.Lens
import           Control.Monad.Change.Modify        (Accessible(..), Proxy(..))
import           Control.Monad.State
import           Control.Monad.Trans.Resource

import           Blockchain.Constants
import           Blockchain.Data.BlockHeader

import           Blockchain.Database.MerklePatricia (StateRoot (..), unboxStateRoot)
import           Blockchain.DB.SQLDB

import           Blockchain.Data.Block
import           Blockchain.Data.DataDefs
import           Blockchain.Data.RLP
import           Blockchain.Data.Transaction
import           Blockchain.Data.TXOrigin
import           Blockchain.ExtWord
import           Blockchain.SHA
import           Blockchain.Util

import           Blockchain.Strato.Model.Class
import qualified Text.Colors                        as CL
import           Text.Format

instance Pretty B.ByteString where
  pretty = blue . text . BC.unpack . B16.encode

blk2BlkDataRef :: HasSQLDB m
               => M.Map SHA Integer
               -> (Block, SHA)
               -> Bool
               -> m BlockDataRef
blk2BlkDataRef dm (b, hash') makeHashOne = do
  let difficulty' = fromMaybe (error $ "missing value in difficulty map: " ++ format hash') $
                   M.lookup hash' dm --  <- calcTotalDifficulty b blkId
  return (BlockDataRef pH uH cB sR tR rR lB d n gL gU t eD nc mH hash'' uncles True True difficulty') --- Horrible! Apparently I need to learn the Lens library, yesterday
  where
      hash'' = if makeHashOne then SHA 1 else hash'
      bd = blockBlockData b
      uncles = blockBlockUncles b
      pH = blockDataParentHash bd
      uH = blockDataUnclesHash bd
      cB = blockDataCoinbase bd
      sR = blockDataStateRoot bd
      tR = blockDataTransactionsRoot bd
      rR = blockDataReceiptsRoot bd
      lB = blockDataLogBloom bd
      n =  blockDataNumber bd
      d  = blockDataDifficulty bd
      gL = blockDataGasLimit bd
      gU = blockDataGasUsed bd
      t  = blockDataTimestamp bd
      eD = blockDataExtraData bd
      nc = blockDataNonce bd
      mH = blockDataMixHash bd

getBlock :: HasSQLDB m
         => SHA
         -> m (Maybe BlockDataRef)
getBlock h = do
  db <- access (Proxy @SQLDB)
  entBlkL <- runResourceT $
    SQL.runSqlPool actions db

  case entBlkL of
    []  -> return Nothing
    lst -> return $ Just . entityVal . head $ lst
  where actions = E.select $ E.from $ \bdRef -> do
                                   E.where_ (bdRef E.^. BlockDataRefHash E.==. E.val h )
                                   return bdRef

-- if useDiffBomb is False then the expAdjustment is not added.
nextDifficulty::Bool->Bool->Integer->Difficulty->UTCTime->UTCTime->Difficulty
nextDifficulty useDiffBomb useTestnet parentNumber oldDifficulty oldTime newTime =
  max nextDiff' minimumDifficulty + if not useDiffBomb then 0 else expAdjustment
    where
      nextDiff' =
          if round (utcTimeToPOSIXSeconds newTime) >=
                 (round (utcTimeToPOSIXSeconds oldTime) + difficultyDurationLimit useTestnet::Integer)
          then oldDifficulty - oldDifficulty `shiftR` difficultyAdjustment
          else oldDifficulty + oldDifficulty `shiftR` difficultyAdjustment
      periodCount = (parentNumber+1) `quot` difficultyExpDiffPeriod
      expAdjustment =
        if periodCount > 1
        then 2^(periodCount - 2)
        else 0

-- if useDiffBomb is False then the expAdjustment is not added
homesteadNextDifficulty::Bool->Bool->Integer->Difficulty->UTCTime->UTCTime->Difficulty
homesteadNextDifficulty useDiffBomb _useTestnet parentNumber oldDifficulty oldTime newTime =
  max nextDiff' minimumDifficulty + if not useDiffBomb then 0 else expAdjustment
    where
      block_timestamp = round (utcTimeToPOSIXSeconds newTime)::Integer
      parent_timestamp = round (utcTimeToPOSIXSeconds oldTime)::Integer
      nextDiff' = oldDifficulty + oldDifficulty `quot` 2048 * max (1 - (block_timestamp - parent_timestamp) `quot` 10) (-99)
      periodCount = (parentNumber+1) `quot` difficultyExpDiffPeriod
      expAdjustment =
        if periodCount > 1
        then 2^(periodCount - 2)
        else 0

getDifficulties :: HasSQLDB m
                => [SHA]
                -> m [(SHA, Integer)]
getDifficulties hashes = do
  db <- access (Proxy @SQLDB)
  blocks <-
    runResourceT $
    flip SQL.runSqlPool db $
    E.select $
    E.from $ \bd -> do
      E.where_ ((bd E.^. BlockDataRefHash) `E.in_` E.valList hashes)
      return (bd E.^. BlockDataRefHash, bd E.^. BlockDataRefTotalDifficulty)

  return $ map f blocks

  where
    f::(E.Value SHA, E.Value Integer)->(SHA, Integer)
    f (h, a) = (E.unValue h, E.unValue a)

addDifficulties::M.Map SHA Integer->[(SHA, Integer, SHA)]->M.Map SHA Integer
addDifficulties dm [] = dm
addDifficulties dm ((hash', blockDifficulty, parentHash'):rest) =
  let parentDifficulty = fromMaybe (error $ "missing hash in difficulty map in addDifficulties: " ++ format parentHash' ++ ", hash=" ++ format hash') $ M.lookup parentHash' dm
      dm' = M.insert hash' (parentDifficulty + blockDifficulty) dm
  in addDifficulties dm' rest

getDifficultyMap :: HasSQLDB m
                 => [(SHA, Integer)]
                 -> [(Block, SHA)]
                 -> m (M.Map SHA Integer)
getDifficultyMap difficultyBase blocksAndHashes = do
  let hashes = S.fromList $ map snd blocksAndHashes
      parents = S.fromList $ map (blockDataParentHash . blockBlockData . fst) blocksAndHashes

  dm' <- M.fromList . (difficultyBase ++) <$> getDifficulties (S.toList $ parents S.\\ hashes)

  return $ addDifficulties dm'
    (map (\(x, y) ->
           (y,
            blockDataDifficulty $ blockBlockData x,
            blockDataParentHash $ blockBlockData x)
         ) blocksAndHashes)


putBlocks :: HasSQLDB m
          => [(SHA, Integer)]
          -> [Block]
          -> Bool
          -> m [Key BlockDataRef]
putBlocks difficultyBase blocks makeHashOne = do
  let blocksAndHashes = map (\b -> (b, blockHash b)) blocks
  dm <- getDifficultyMap difficultyBase blocksAndHashes
  db <- access (Proxy @SQLDB)
  runResourceT $
    flip SQL.runSqlPool db $
    forM blocksAndHashes $ \(b, hash') -> do
      insertTXIfNew' (BlockHash $ blockHash b) (Just $ blockDataNumber $ blockBlockData b) (blockReceiptTransactions b)

      existingBlockData <- SQL.selectList [BlockDataRefHash SQL.==.  blockHash b] []

      case existingBlockData of
           [] -> do
             toInsert <- lift $ lift $ blk2BlkDataRef dm (b, hash') makeHashOne
             blkDataRefId <- SQL.insert toInsert
             forM_ (blockReceiptTransactions b) $ \tx -> do
               txID <- updateBlockNumber b (transactionHash tx) (txChainId tx)
               SQL.insert $ BlockTransaction blkDataRefId txID
             return blkDataRefId
           [bd] -> return $ SQL.entityKey bd
           _ -> error "DB has multiple blocks with the same hash"

  where
    updateBlockNumber b txHash' cid = do
          ret <- SQL.getBy (UniqueTXHash txHash' $ fromMaybe 0 cid)
          key <-
            case ret of
             Just x  -> return $ entityKey x
             Nothing -> error "error in putBlocks: no transaction exists in the DB, even though I just inserted it"
          SQL.update key [RawTransactionBlockNumber SQL.=. fromIntegral (blockDataNumber (blockBlockData b))]
          return key

instance Format Block where
  format b@Block{blockBlockData=bd, blockReceiptTransactions=receipts, blockBlockUncles=uncles} =
    CL.blue ("Block #" ++ show (blockDataNumber bd)) ++ " " ++
    tab (format (blockHash b) ++ "\n" ++
         format bd ++
         (if null receipts
          then "        (no transactions)\n"
          else tab (intercalate "\n    " (format <$> receipts))) ++
         (if null uncles
          then "        (no uncles)"
          else tab ("Uncles:" ++ tab ("\n" ++ intercalate "\n    " (format <$> uncles)))))

instance RLPSerializable Block where
  rlpDecode (RLPArray [bd, RLPArray transactionReceipts, RLPArray uncles]) =
    Block (rlpDecode bd) (rlpDecode <$> transactionReceipts) (rlpDecode <$> uncles)
  rlpDecode (RLPArray arr) = error ("rlpDecode for Block called on object with wrong amount of data, length arr = " ++ show arr)
  rlpDecode x = error ("rlpDecode for Block called on non block object: " ++ show x)

  rlpEncode Block{blockBlockData=bd, blockReceiptTransactions=receipts, blockBlockUncles=uncles} =
    RLPArray [rlpEncode bd, RLPArray (rlpEncode <$> receipts), RLPArray $ rlpEncode <$> uncles]

instance RLPSerializable BlockData where
  rlpDecode (RLPArray [v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15]) =
    BlockData {
      blockDataParentHash = rlpDecode v1,
      blockDataUnclesHash = rlpDecode v2,
      blockDataCoinbase = rlpDecode v3,
      blockDataStateRoot = rlpDecode v4,
      blockDataTransactionsRoot = rlpDecode v5,
      blockDataReceiptsRoot = rlpDecode v6,
      blockDataLogBloom = rlpDecode v7,
      blockDataDifficulty = rlpDecode v8,
      blockDataNumber = rlpDecode v9,
      blockDataGasLimit = rlpDecode v10,
      blockDataGasUsed = rlpDecode v11,
      blockDataTimestamp = posixSecondsToUTCTime $ fromInteger $ rlpDecode v12,
      blockDataExtraData = rlpDecode v13,
      blockDataMixHash = rlpDecode v14,
      blockDataNonce = bytesToWord64 $ B.unpack $ rlpDecode v15
      }
  rlpDecode (RLPArray arr) = error ("Error in rlpDecode for Block: wrong number of items, expected 15, got " ++ show (length arr) ++ ", arr = " ++ show (pretty arr))
  rlpDecode x = error ("rlp2BlockData called on non block object: " ++ show x)


  rlpEncode bd =
    RLPArray [
      rlpEncode $ blockDataParentHash bd,
      rlpEncode $ blockDataUnclesHash bd,
      rlpEncode $ blockDataCoinbase bd,
      rlpEncode $ blockDataStateRoot bd,
      rlpEncode $ blockDataTransactionsRoot bd,
      rlpEncode $ blockDataReceiptsRoot bd,
      rlpEncode $ blockDataLogBloom bd,
      rlpEncode $ blockDataDifficulty bd,
      rlpEncode $ blockDataNumber bd,
      rlpEncode $ blockDataGasLimit bd,
      rlpEncode $ blockDataGasUsed bd,
      rlpEncode (round $ utcTimeToPOSIXSeconds $ blockDataTimestamp bd::Integer),
      rlpEncode $ blockDataExtraData bd,
      rlpEncode $ blockDataMixHash bd,
      rlpEncode $ B.pack $ word64ToBytes $ blockDataNonce bd
      ]


instance Format BlockData where
  format b =
    "parentHash: " ++ format (blockDataParentHash b) ++ "\n" ++
    "unclesHash: " ++ format (blockDataUnclesHash b) ++
    (if blockDataUnclesHash b == hash (B.pack [0xc0]) then " (the empty array)\n" else "\n") ++
    "coinbase: " ++ show (pretty $ blockDataCoinbase b) ++ "\n" ++
    "stateRoot: " ++ format (blockDataStateRoot b) ++ "\n" ++
    "transactionsRoot: " ++ format (blockDataTransactionsRoot b) ++ "\n" ++
    "receiptsRoot: " ++ format (blockDataReceiptsRoot b) ++ "\n" ++
    "difficulty: " ++ show (blockDataDifficulty b) ++ "\n" ++
    "gasLimit: " ++ show (blockDataGasLimit b) ++ "\n" ++
    "gasUsed: " ++ show (blockDataGasUsed b) ++ "\n" ++
    "timestamp: " ++ show (blockDataTimestamp b) ++ "\n" ++
    "extraData: " ++ show (pretty $ blockDataExtraData b) ++ "\n" ++
    "nonce: " ++ showHex (blockDataNonce b) "" ++ "\n"

instance BlockLike BlockData Transaction Block where
    blockHeader       = blockBlockData
    blockTransactions = blockReceiptTransactions
    blockUncleHeaders = blockBlockUncles

    buildBlock = Block

instance BlockHeaderLike BlockData where
    blockHeaderBlockNumber      = blockDataNumber
    blockHeaderParentHash       = blockDataParentHash
    blockHeaderOmmersHash       = blockDataUnclesHash
    blockHeaderBeneficiary      = blockDataCoinbase
    blockHeaderStateRoot        = unboxStateRoot . blockDataStateRoot
    blockHeaderTransactionsRoot = unboxStateRoot . blockDataTransactionsRoot
    blockHeaderReceiptsRoot     = unboxStateRoot . blockDataReceiptsRoot
    blockHeaderLogsBloom        = blockDataLogBloom
    blockHeaderGasLimit         = blockDataGasLimit
    blockHeaderGasUsed          = blockDataGasUsed
    blockHeaderDifficulty       = blockDataDifficulty
    blockHeaderNonce            = blockDataNonce
    blockHeaderExtraData        = blockDataExtraData
    blockHeaderTimestamp        = blockDataTimestamp
    blockHeaderMixHash          = blockDataMixHash

    blockHeaderModifyExtra      = over extraDataLens

    morphBlockHeader h2 =
        BlockData { blockDataNumber           = blockHeaderBlockNumber h2
                  , blockDataParentHash       = blockHeaderParentHash h2
                  , blockDataUnclesHash       = blockHeaderOmmersHash h2
                  , blockDataCoinbase         = blockHeaderBeneficiary h2
                  , blockDataStateRoot        = StateRoot $ blockHeaderStateRoot h2
                  , blockDataTransactionsRoot = StateRoot $ blockHeaderTransactionsRoot h2
                  , blockDataReceiptsRoot     = StateRoot $ blockHeaderReceiptsRoot h2
                  , blockDataLogBloom         = blockHeaderLogsBloom h2
                  , blockDataGasLimit         = blockHeaderGasLimit h2
                  , blockDataGasUsed          = blockHeaderGasUsed h2
                  , blockDataDifficulty       = blockHeaderDifficulty h2
                  , blockDataNonce            = blockHeaderNonce h2
                  , blockDataExtraData        = blockHeaderExtraData h2
                  , blockDataTimestamp        = blockHeaderTimestamp h2
                  , blockDataMixHash          = blockHeaderMixHash h2
                  }

createBlockFromHeaderAndBody::BlockHeader->([Transaction], [BlockHeader])->Block
createBlockFromHeaderAndBody header (transactions, uncles) =
  Block (headerToBlockData header) transactions (map headerToBlockData uncles)
  where
    headerToBlockData (BlockHeader ph oh b sr tr rr lb d number' gl gu ts ed mh nonce') =
      BlockData ph oh b sr tr rr lb d number' gl gu ts ed nonce' mh

