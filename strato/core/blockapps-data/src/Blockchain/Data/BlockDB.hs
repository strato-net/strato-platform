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
    putBlocksSql,
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
import qualified Data.ByteString.Short as BSS
import qualified Data.Map.Strict as M
import Data.Maybe
import qualified Database.Esqueleto.Legacy as E
import Database.Persist hiding (get)
import qualified Database.Persist.Postgresql as SQL
import Crypto.Secp256k1.Internal
import UnliftIO (MonadUnliftIO)

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
putBlocks blockList makeHashOne = sqlQuery $ putBlocksSql blockList makeHashOne

-- | The body of 'putBlocks' as one 'SQL.SqlPersistT' action, so a caller can
-- commit a batch's blocks together with its receipts, state diffs and
-- progress marker in a single transaction. Idempotent: a block whose hash is
-- already present is skipped and its existing key returned.
putBlocksSql ::
  MonadUnliftIO m =>
  [Block] ->
  Bool ->
  SQL.SqlPersistT m [Key BlockDataRef]
putBlocksSql blockList makeHashOne = do
  let blocksWithHashes = (\b -> (b, blockHash b)) <$> blockList
  -- Everything is done per batch, table by table: a fixed handful of
  -- statements however many blocks are in the batch. insertMany returns the
  -- generated keys in one statement, so nothing is read back row by row.
  existing <- M.fromList . map (\e -> (blockDataRefHash (entityVal e), entityKey e))
    <$> SQL.selectList [BlockDataRefHash SQL.<-. map snd blocksWithHashes] []

  -- Transactions submitted through the API already exist with block_number -1:
  -- those get their block number set; the rest are inserted. A tx hash may
  -- occur more than once in a batch (two blocks carrying the same tx), so
  -- insert each hash once and let every occurrence resolve to that key.
  let txsWithBlock = [ (tx, hash', blockBlockData b) | (b, hash') <- blocksWithHashes, tx <- blockReceiptTransactions b ]
  known <- M.fromList . map (\(E.Value k, E.Value h) -> (h, k))
    <$> E.select (E.from $ \t -> do
          E.where_ $ t E.^. RawTransactionTxHash `E.in_` E.valList (map (\(tx, _, _) -> transactionHash tx) txsWithBlock)
          return (t E.^. RawTransactionId, t E.^. RawTransactionTxHash))
  let byBlockNumber = M.fromListWith (++)
        [ (number bd, [k]) | (tx, _, bd) <- txsWithBlock, Just k <- [M.lookup (transactionHash tx) known] ]
  sequence_ $ M.mapWithKey
    (\n ks -> SQL.updateWhere [RawTransactionId SQL.<-. ks] [RawTransactionBlockNumber SQL.=. fromIntegral n])
    byBlockNumber
  let newTxs = M.elems $ M.fromList
        [ (transactionHash tx, txAndTime2RawTX (BlockHash hash') tx (number bd) (timestamp bd))
        | (tx, hash', bd) <- txsWithBlock, M.notMember (transactionHash tx) known ]
  newKeys <- SQL.insertMany newTxs
  let txKey = M.union known $ M.fromList (zip (map rawTransactionTxHash newTxs) newKeys)

  let newBlocks = [ (b, hash', blk2BlkDataRef b hash' makeHashOne) | (b, hash') <- blocksWithHashes, M.notMember hash' existing ]
  blkKeys <- SQL.insertMany [ toInsert | (_, _, (toInsert, _, _, _, _, _, _)) <- newBlocks ]
  let withKeys = zip blkKeys newBlocks
      sigParts sig = ( bytesToWord256 . BSS.fromShort $ getCompactRecSigR sig
                     , bytesToWord256 . BSS.fromShort $ getCompactRecSigS sig
                     , getCompactRecSigV sig )
  SQL.insertMany_ [ BlockTransaction k (txKey M.! transactionHash tx) | (k, (b, _, _)) <- withKeys, tx <- blockReceiptTransactions b ]
  SQL.insertMany_ [ BlockValidatorRef k v | (k, (_, _, (_, vs, _, _, _, _, _))) <- withKeys, v <- vs ]
  SQL.insertMany_ $ [ ValidatorDeltaRef k v True | (k, (_, _, (_, _, va, _, _, _, _))) <- withKeys, v <- va ]
                 ++ [ ValidatorDeltaRef k v False | (k, (_, _, (_, _, _, vr, _, _, _))) <- withKeys, v <- vr ]
  SQL.insertMany_ [ BlockStakeRef k val st isUpd | (k, (_, _, (_, _, _, _, _, _, stakes))) <- withKeys, (val, st, isUpd) <- stakes ]
  SQL.insertMany_
    [ ProposalSignatureRef k signer' r s v
    | (k, (b, _, (_, _, _, _, ps, _, _))) <- withKeys, Signature sig <- maybeToList ps
    , let (r, s, v) = sigParts sig
          signer' = fromMaybe (Address 0) $ verifyProposerSeal b (Signature sig)
    ]
  SQL.insertMany_
    [ CommitmentSignatureRef k signer' r s v
    | (k, (_, hash', (_, _, _, _, _, sigs, _))) <- withKeys, Signature sig <- sigs
    , let (r, s, v) = sigParts sig
          signer' = either (const $ Address 0) id $ verifyCommitmentSeal hash' (Signature sig)
    ]

  let blockKey = M.union existing $ M.fromList [ (hash', k) | (k, (_, hash', _)) <- withKeys ]
  return [ blockKey M.! hash' | (_, hash') <- blocksWithHashes ]
