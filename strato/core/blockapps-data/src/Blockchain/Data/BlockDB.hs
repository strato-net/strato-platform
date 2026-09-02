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
import Blockchain.Data.Transaction (insertTXIfNew', transactionHash)
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Secp256k1
import Blockchain.Strato.Model.Validator
import Control.Monad (forM, forM_, when)
import qualified Data.ByteString.Short as BSS
import Data.List (foldl')
import qualified Data.Map.Strict as M
import Data.Maybe
import qualified Data.Set as S
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
    forM_ blocksWithHashes $ \(b, _) ->
      insertTXIfNew'
        (BlockHash $ blockHash b)
        (Just $ number $ blockBlockData b)
        (timestamp $ blockBlockData b)
        (blockReceiptTransactions b)

    existingBlocks <-
      if null blocksWithHashes
        then pure []
        else SQL.selectList [BlockDataRefHash SQL.<-. (snd <$> blocksWithHashes)] []
    let existingByHash =
          M.fromListWithKey
            (\blockHash' _ _ -> error $ "DB has multiple blocks with the same hash: " ++ show blockHash')
            [ (blockDataRefHash blockData, SQL.entityKey entity)
            | entity <- existingBlocks,
              let blockData = SQL.entityVal entity
            ]
        uniqueMissingBlocks =
          snd $
            foldl'
              (\(seen, missing) blockAndHash@(_, hash') ->
                 if hash' `S.member` seen || hash' `M.member` existingByHash
                   then (seen, missing)
                   else (S.insert hash' seen, blockAndHash : missing)
              )
              (S.empty, [])
              blocksWithHashes
        missingBlocks = reverse uniqueMissingBlocks
        missingRows =
          [ (b, hash', blk2BlkDataRef b hash' makeHashOne)
          | (b, hash') <- missingBlocks
          ]

    insertedBlockIds <-
      SQL.insertMany
        [ blockDataRef
        | (_, _, (blockDataRef, _, _, _, _, _, _)) <- missingRows
        ]
    let insertedRows =
          [ (b, hash', blockDataRefId, validators, addedValidators, removedVals, proposal, commitmentSigs, stakes)
          | ((b, hash', (_, validators, addedValidators, removedVals, proposal, commitmentSigs, stakes)), blockDataRefId) <- zip missingRows insertedBlockIds
          ]
        insertedByHash =
          M.fromList
            [ (hash', blockDataRefId)
            | (_, hash', blockDataRefId, _, _, _, _, _, _) <- insertedRows
            ]
        allBlockIds = M.union existingByHash insertedByHash
        transactionAssignments =
          [ (transactionHash tx, blockDataRefId, fromIntegral $ number $ blockBlockData b)
          | (b, _, blockDataRefId, _, _, _, _, _, _) <- insertedRows,
            tx <- blockReceiptTransactions b
          ]
        transactionHashes =
          S.toList . S.fromList $ [transactionHash' | (transactionHash', _, _) <- transactionAssignments]

    transactionEntities <-
      if null transactionHashes
        then pure []
        else SQL.selectList [RawTransactionTxHash SQL.<-. transactionHashes] []
    let transactionsByHash =
          M.fromList
            [ (rawTransactionTxHash rawTransaction, entity)
            | entity <- transactionEntities,
              let rawTransaction = SQL.entityVal entity
            ]
        finalTransactionBlockNumbers =
          M.fromList
            [ (transactionHash', blockNumber)
            | (transactionHash', _, blockNumber) <- transactionAssignments
            ]

    forM_ (M.toList finalTransactionBlockNumbers) $ \(transactionHash', blockNumber) ->
      case M.lookup transactionHash' transactionsByHash of
        Nothing -> error "error in putBlocks: no transaction exists in the DB, even though I just inserted it"
        Just entity ->
          when (rawTransactionBlockNumber (SQL.entityVal entity) /= blockNumber) $
            SQL.update (SQL.entityKey entity) [RawTransactionBlockNumber SQL.=. blockNumber]

    SQL.insertMany_
      [ BlockTransaction blockDataRefId (SQL.entityKey transactionEntity)
      | (transactionHash', blockDataRefId, _) <- transactionAssignments,
        Just transactionEntity <- [M.lookup transactionHash' transactionsByHash]
      ]
    SQL.insertMany_
      [ BlockValidatorRef blockDataRefId validator
      | (_, _, blockDataRefId, validators, _, _, _, _, _) <- insertedRows,
        validator <- validators
      ]
    SQL.insertMany_
      [ ValidatorDeltaRef blockDataRefId validator True
      | (_, _, blockDataRefId, _, validators, _, _, _, _) <- insertedRows,
        validator <- validators
      ]
    SQL.insertMany_
      [ ValidatorDeltaRef blockDataRefId validator False
      | (_, _, blockDataRefId, _, _, validators, _, _, _) <- insertedRows,
        validator <- validators
      ]
    SQL.insertMany_
      [ BlockStakeRef blockDataRefId validator stake isUpdate
      | (_, _, blockDataRefId, _, _, _, _, _, stakes) <- insertedRows,
        (validator, stake, isUpdate) <- stakes
      ]
    SQL.insertMany_
      [ let r = bytesToWord256 . BSS.fromShort $ getCompactRecSigR sig
            s = bytesToWord256 . BSS.fromShort $ getCompactRecSigS sig
            v = getCompactRecSigV sig
            signer = fromMaybe (Address 0) $ verifyProposerSeal b (Signature sig)
         in ProposalSignatureRef blockDataRefId signer r s v
      | (b, _, blockDataRefId, _, _, _, Just (Signature sig), _, _) <- insertedRows
      ]
    SQL.insertMany_
      [ let r = bytesToWord256 . BSS.fromShort $ getCompactRecSigR sig
            s = bytesToWord256 . BSS.fromShort $ getCompactRecSigS sig
            v = getCompactRecSigV sig
            signer = either (const $ Address 0) id $ verifyCommitmentSeal hash' (Signature sig)
         in CommitmentSignatureRef blockDataRefId signer r s v
      | (_, hash', blockDataRefId, _, _, _, _, commitmentSigs, _) <- insertedRows,
        Signature sig <- commitmentSigs
      ]

    forM blocksWithHashes $ \(_, hash') ->
      maybe
        (error $ "putBlocks: missing block id after insert for " ++ show hash')
        pure
        (M.lookup hash' allBlockIds)
