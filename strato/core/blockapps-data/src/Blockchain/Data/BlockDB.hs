{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE GADTs #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}

module Blockchain.Data.BlockDB
  ( getBlock,
    putBlocks,
  )
where

import Blockchain.Blockstanbul.Model.Authentication
import Blockchain.DB.SQLDB
import Blockchain.Data.Block
import Blockchain.Data.BlockHeader
import Blockchain.Data.DataDefs
import Blockchain.Data.TXOrigin
import Blockchain.Data.Transaction (transactionHash, txAndTime2RawTX)
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Secp256k1
import Blockchain.Strato.Model.Validator
import Control.Monad (forM)
import qualified Data.ByteString.Short as BSS
import qualified Data.Map.Strict as M
import Data.Maybe
import qualified Database.Esqueleto.Legacy as E
import Database.Persist hiding (get)
import qualified Database.Persist.Postgresql as SQL
import Crypto.Secp256k1.Internal

blk2BlkDataRef ::
  Block ->
  Keccak256 ->
  Bool ->
  (BlockDataRef, [Validator], [Validator], [Validator], Maybe Signature, [Signature], [(Validator, Integer, Bool)])
blk2BlkDataRef b hash' makeHashOne =
  let bdr = BlockDataRef pH uH cC sR tR rR lB d n gL gU t eD nc mH hash'' True True v pr --- Horrible! Apparently I need to learn the Lens library, yesterday
   in (bdr, vs, va, vr, ps, sigs, stakes)
  where
    hash'' = if makeHashOne then unsafeCreateKeccak256FromWord256 1 else hash'
    cC = getBlockBeneficiary bd
    bd = blockBlockData b
    pH = parentHash bd
    sR = stateRoot bd
    tR = transactionsRoot bd
    rR = receiptsRoot bd
    lB = logsBloom bd
    n = number bd
    t = timestamp bd
    eD = extraData bd
    nc = getBlockNonce bd
    d = getBlockDifficulty bd
    gL = getBlockGasLimit bd
    gU = getBlockGasUsed bd
    uH = getBlockOmmersHash bd
    mH = getBlockMixHash bd
    v = blockHeaderVersion bd
    vs = blockHeaderValidators bd
    va = blockHeaderNewValidators bd
    vr = blockHeaderRemovedValidators bd
    ps = blockHeaderProposal bd
    sigs = blockHeaderSignatures bd
    pr = if v >= 3 then Just (blockHeaderRound bd) else Nothing
    -- (validator, stake, isUpdate): current stakes carry False, stake updates True
    stakes = [ (val, st, isUpd)
             | (isUpd, rows) <- [(False, blockHeaderStakes bd), (True, blockHeaderStakeUpdates bd)]
             , (val, st) <- rows ]

getBlock ::
  HasSQLDB m =>
  Keccak256 ->
  m (Maybe BlockDataRef)
getBlock h = do
  entBlkL <- sqlQuery actions

  case entBlkL of
    [] -> return Nothing
    (x:_) -> return . Just $ entityVal x
  where
    actions = E.select $
      E.from $ \bdRef -> do
        E.where_ (bdRef E.^. BlockDataRefHash E.==. E.val h)
        return bdRef

putBlocks ::
  HasSQLDB m =>
  [Block] ->
  Bool ->
  m [Key BlockDataRef]
putBlocks blockList makeHashOne = do
  let blocksWithHashes = (\b -> (b, blockHash b)) <$> blockList
  sqlQuery $ do
    -- One lookup for the whole batch instead of a SELECT per block.
    existing <- M.fromList . map (\e -> (blockDataRefHash (entityVal e), entityKey e))
      <$> SQL.selectList [BlockDataRefHash SQL.<-. map snd blocksWithHashes] []
    forM blocksWithHashes $ \(b, hash') -> do
      let bd = blockBlockData b
      txIDs <- forM (blockReceiptTransactions b) $ \tx -> do
        -- Fetch only the id (the full row carries code/args/tx_data). Transactions
        -- submitted through the API already exist with block_number -1.
        mKey <- listToMaybe <$> SQL.selectKeysList [RawTransactionTxHash SQL.==. transactionHash tx] [LimitTo 1]
        case mKey of
          Just key -> key <$ SQL.update key [RawTransactionBlockNumber SQL.=. fromIntegral (number bd)]
          Nothing -> SQL.insert $ txAndTime2RawTX (BlockHash hash') tx (number bd) (timestamp bd)

      case M.lookup hash' existing of
        Just key -> return key
        Nothing -> do
          let (toInsert, vs, va, vr, ps, sigs, stakes) = blk2BlkDataRef b hash' makeHashOne
          blkDataRefId <- SQL.insert toInsert
          SQL.insertMany_ $ map (BlockTransaction blkDataRefId) txIDs
          SQL.insertMany_ $ map (BlockValidatorRef blkDataRefId) vs
          SQL.insertMany_ $ map (\v -> ValidatorDeltaRef blkDataRefId v True) va
          SQL.insertMany_ $ map (\v -> ValidatorDeltaRef blkDataRefId v False) vr
          SQL.insertMany_ $ map (\(val, st, isUpd) -> BlockStakeRef blkDataRefId val st isUpd) stakes
          SQL.insertMany_
            [ ProposalSignatureRef blkDataRefId signer' r s v
            | Signature sig <- maybeToList ps
            , let r = bytesToWord256 . BSS.fromShort $ getCompactRecSigR sig
                  s = bytesToWord256 . BSS.fromShort $ getCompactRecSigS sig
                  v = getCompactRecSigV sig
                  signer' = fromMaybe (Address 0) $ verifyProposerSeal b (Signature sig)
            ]
          SQL.insertMany_
            [ CommitmentSignatureRef blkDataRefId signer' r s v
            | Signature sig <- sigs
            , let r = bytesToWord256 . BSS.fromShort $ getCompactRecSigR sig
                  s = bytesToWord256 . BSS.fromShort $ getCompactRecSigS sig
                  v = getCompactRecSigV sig
                  signer' = either (const $ Address 0) id $ verifyCommitmentSeal hash' (Signature sig)
            ]
          return blkDataRefId
