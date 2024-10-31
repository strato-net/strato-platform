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

import BlockApps.X509
import Blockchain.Blockstanbul.Model.Authentication
import Blockchain.DB.SQLDB
import Blockchain.Data.Block
import Blockchain.Data.BlockHeader
import Blockchain.Data.DataDefs
import Blockchain.Data.TXOrigin
import Blockchain.Data.Transaction
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainMember hiding (commonName)
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Secp256k1
import Blockchain.Strato.Model.Validator
import Control.Monad (forM, forM_)
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Short as BSS
import Data.Maybe
import qualified Data.Text as T
import qualified Database.Esqueleto.Legacy as E
import Database.Persist hiding (get)
import qualified Database.Persist.Postgresql as SQL
import Crypto.Secp256k1.Internal

blk2BlkDataRef ::
  Block ->
  Keccak256 ->
  Bool ->
  (BlockDataRef, [Validator], [Validator], [Validator], [X509Certificate], [DummyCertRevocation], Maybe Signature, [Signature])
blk2BlkDataRef b hash' makeHashOne =
  let bdr = BlockDataRef pH uH cC sR tR rR lB d n gL gU t eD nc mH hash'' True True v --- Horrible! Apparently I need to learn the Lens library, yesterday
   in (bdr, vs, va, vr, ca, cr, ps, sigs)
  where
    hash'' = if makeHashOne then unsafeCreateKeccak256FromWord256 1 else hash'
    cC = case cB of
      CommonName _ _ c _ -> c
      _ -> ""
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
    cB = getBlockBeneficiary bd
    mH = getBlockMixHash bd
    v = blockHeaderVersion bd
    vs = blockHeaderValidators bd
    va = blockHeaderNewValidators bd
    vr = blockHeaderRemovedValidators bd
    ca = blockHeaderNewCerts bd
    cr = blockHeaderRevokedCerts bd
    ps = blockHeaderProposal bd
    sigs = blockHeaderSignatures bd

getBlock ::
  HasSQLDB m =>
  Keccak256 ->
  m (Maybe BlockDataRef)
getBlock h = do
  entBlkL <- sqlQuery actions

  case entBlkL of
    [] -> return Nothing
    lst -> return $ Just . entityVal . head $ lst
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
  sqlQuery $
    forM blocksWithHashes $ \(b, hash') -> do
      insertTXIfNew' (BlockHash $ blockHash b) (Just $ number $ blockBlockData b) (blockReceiptTransactions b)

      existingBlockData <- SQL.selectList [BlockDataRefHash SQL.==. blockHash b] []

      case existingBlockData of
        [] -> do
          let (toInsert, vs, va, vr, ca, cr, ps, sigs) = blk2BlkDataRef b hash' makeHashOne
          blkDataRefId <- SQL.insert toInsert
          forM_ (blockReceiptTransactions b) $ \tx -> do
            txID <- updateBlockNumber b (transactionHash tx) (txChainId tx)
            SQL.insert $ BlockTransaction blkDataRefId txID
          forM_ vs $ \(Validator v) -> SQL.insert $ BlockValidatorRef blkDataRefId v
          forM_ va $ \(Validator v) -> SQL.insert $ ValidatorDeltaRef blkDataRefId v True
          forM_ vr $ \(Validator v) -> SQL.insert $ ValidatorDeltaRef blkDataRefId v False
          forM_ ca $ \c -> do
            let c' = x509CertToCertInfoState c 
            SQL.insert $ CertificateAddedRef blkDataRefId (T.pack $ commonName c') (userAddress c') (T.pack . BC.unpack . certToBytes $ certificate c')
          forM_ cr $ \(DummyCertRevocation ua) -> do
            SQL.insert $ CertificateRevokedRef blkDataRefId ua
          forM_ ps $ \(Signature sig) -> do
            let r = bytesToWord256 . BSS.fromShort $ getCompactRecSigR sig
                s = bytesToWord256 . BSS.fromShort $ getCompactRecSigS sig
                v = getCompactRecSigV sig
                signer' = fromMaybe (Address 0) $ verifyProposerSeal b (Signature sig)
            SQL.insert $ ProposalSignatureRef blkDataRefId signer' r s v
          forM_ sigs $ \(Signature sig) -> do
            let r = bytesToWord256 . BSS.fromShort $ getCompactRecSigR sig
                s = bytesToWord256 . BSS.fromShort $ getCompactRecSigS sig
                v = getCompactRecSigV sig
                signer' = either (const $ Address 0) id $ verifyCommitmentSeal hash' (Signature sig)
            SQL.insert $ CommitmentSignatureRef blkDataRefId signer' r s v

          return blkDataRefId
        [bd] -> return $ SQL.entityKey bd
        _ -> error "DB has multiple blocks with the same hash"
  where
    updateBlockNumber b txHash' cid = do
      ret <- SQL.getBy (UniqueTXHash txHash' $ fromMaybe 0 cid)
      key <-
        case ret of
          Just x -> return $ entityKey x
          Nothing -> error "error in putBlocks: no transaction exists in the DB, even though I just inserted it"
      SQL.update key [RawTransactionBlockNumber SQL.=. fromIntegral (number (blockBlockData b))]
      return key
