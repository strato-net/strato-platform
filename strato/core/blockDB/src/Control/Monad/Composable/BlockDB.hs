{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeOperators #-}

module Control.Monad.Composable.BlockDB
  ( BlockDBEnv,
    BlockDBM,
    HasBlockDB,
    runBlockDB,
    getBlockHeader,
    getCanonicalBlockHeaders,
    getBlockBodies,
  ) where

import Blockchain.DB.SQLDB (SQLDB, runSqlPool)
import Blockchain.Data.Block (blockBlockData)
import Blockchain.Data.BlockHeader (BlockHeader(..))
import Blockchain.Data.DataDefs
import Blockchain.Data.Transaction (Transaction(MessageTX, ContractCreationTX, EthereumTX))
import Blockchain.Model.JsonBlock (blockDataRefToBlock)
import Blockchain.Strato.Model.Address (addressFromByteString)
import Blockchain.Strato.Model.Secp256k1 (importSignature)
import Blockchain.Strato.Model.Validator (Validator(..))
import Blockchain.Strato.Model.Class (blockHeaderBlockNumber)
import Blockchain.Strato.Model.Keccak256 (Keccak256)
import Control.Monad.Composable.Base
import qualified Data.ByteString as B
import qualified Data.Map.Strict as M
import Data.Maybe (fromMaybe, listToMaybe, mapMaybe)
import qualified Data.Text as T
import qualified Database.Esqueleto.Legacy as E
import qualified Database.Persist.Sql as SQL
import UnliftIO (MonadUnliftIO)

newtype BlockDBEnv = BlockDBEnv SQLDB

type BlockDBM es = Eff (BlockDBEnv ': es)

type HasBlockDB m = (MonadUnliftIO m, AccessibleEnv BlockDBEnv m)

runBlockDB :: SQLDB -> BlockDBM es a -> Eff es a
runBlockDB = provide . BlockDBEnv

getBlockHeader :: HasBlockDB m => Keccak256 -> m (Maybe BlockHeader)
getBlockHeader sha = listToMaybe <$> getBlockHeaders [BlockDataRefHash SQL.==. sha]

getCanonicalBlockHeaders :: HasBlockDB m => [Integer] -> m (M.Map Integer BlockHeader)
getCanonicalBlockHeaders numbers = do
  headers <- getBlockHeaders
    [BlockDataRefNumber SQL.<-. numbers, BlockDataRefPowVerified SQL.==. True, BlockDataRefIsConfirmed SQL.==. True]
  return $ M.fromList [(blockHeaderBlockNumber header, header) | header <- headers]

getBlockHeaders :: HasBlockDB m => [SQL.Filter BlockDataRef] -> m [BlockHeader]
getBlockHeaders filters = do
  BlockDBEnv pool <- accessEnv
  runSqlPool (do
    blocks <- SQL.selectList filters [SQL.Asc BlockDataRefNumber, SQL.Asc BlockDataRefId]
    let ids = map SQL.entityKey blocks
        validators table condition =
          "(SELECT string_agg(decode(v.validator,'hex'),''::bytea ORDER BY v.id) FROM " <> table
            <> " v WHERE v.block_data_ref_id=b.id" <> condition <> ")"
        signatureAggregate table =
          "(SELECT string_agg(decode(lpad(v.r,64,'0')||lpad(v.s,64,'0')||lpad(to_hex(v.v),2,'0'),'hex'),''::bytea ORDER BY v.id) FROM "
            <> table <> " v WHERE v.block_data_ref_id=b.id)"
        aggregates =
          [ validators "block_validator_ref" "",
            validators "validator_delta_ref" " AND v.direction",
            validators "validator_delta_ref" " AND NOT v.direction",
            signatureAggregate "proposal_signature_ref",
            signatureAggregate "commitment_signature_ref"
          ]
        query = "SELECT b.id," <> T.intercalate "," ["COALESCE(" <> aggregate <> ",''::bytea)" | aggregate <- aggregates]
          <> " FROM block_data_ref b WHERE b.id IN (" <> T.intercalate "," (replicate (length ids) "?") <> ")"
        chunks size bytes
          | B.null bytes = []
          | otherwise = let (one, rest) = B.splitAt size bytes in one : chunks size rest
        decodeValidators = map (Validator . addressFromByteString) . chunks 20
        decodeSignature = either (const Nothing) Just . importSignature
    if null blocks then return [] else do
      rows <- SQL.rawSql query (map SQL.toPersistValue ids)
      stakes <- if any ((== 3) . blockDataRefVersion . SQL.entityVal) blocks
        then SQL.selectList [BlockStakeRefBlockDataRefId SQL.<-. ids] [SQL.Asc BlockStakeRefId]
        else return []
      let metadata = M.fromList
            [(key, (decodeValidators vs, decodeValidators new, decodeValidators removed,
                    listToMaybe (chunks 65 proposal) >>= decodeSignature,
                    mapMaybe decodeSignature $ chunks 65 commits))
            | (SQL.Single key, SQL.Single vs, SQL.Single new, SQL.Single removed, SQL.Single proposal, SQL.Single commits) <- rows]
          stakesByBlock = M.fromListWith (flip (++))
            [(blockStakeRefBlockDataRefId (SQL.entityVal row), [SQL.entityVal row]) | row <- stakes]
          headerFor row =
            let key = SQL.entityKey row
                (vs, new, removed, proposal, commits) = M.findWithDefault ([], [], [], Nothing, []) key metadata
                header = blockBlockData $ blockDataRefToBlock (SQL.entityVal row)
                  [BlockValidatorRef key v | v <- vs]
                  ([ValidatorDeltaRef key v True | v <- new] ++ [ValidatorDeltaRef key v False | v <- removed])
                  [] [] (M.findWithDefault [] key stakesByBlock) []
            in case header of
              BlockHeader {} -> header
              _ -> header {proposalSignature = proposal, signatures = commits}
      return $ map headerFor blocks) pool

getBlockBodies :: HasBlockDB m => [Keccak256] -> m (M.Map Keccak256 [Transaction])
getBlockBodies hashes = do
  BlockDBEnv pool <- accessEnv
  runSqlPool (do
    blocks <- E.select $ E.from $ \block -> do
      E.where_ $ block E.^. BlockDataRefHash `E.in_` E.valList hashes
      return (block E.^. BlockDataRefId, block E.^. BlockDataRefHash)
    let ids = map (E.unValue . fst) blocks
    if null ids then return M.empty else do
      rows <- E.select $ E.from $ \(btx `E.InnerJoin` tx) -> do
        E.on (tx E.^. RawTransactionId E.==. btx E.^. BlockTransactionTransaction)
        E.where_ $ btx E.^. BlockTransactionBlockDataRefId `E.in_` E.valList ids
        E.orderBy [E.asc (btx E.^. BlockTransactionId)]
        return (btx E.^. BlockTransactionBlockDataRefId,
          (tx E.^. RawTransactionNonce, tx E.^. RawTransactionGasLimit, tx E.^. RawTransactionChainId,
           tx E.^. RawTransactionR, tx E.^. RawTransactionS, tx E.^. RawTransactionV, tx E.^. RawTransactionTxVersion),
          (tx E.^. RawTransactionToAddress, tx E.^. RawTransactionFuncName, tx E.^. RawTransactionContractName,
           tx E.^. RawTransactionArgs, tx E.^. RawTransactionNetwork, tx E.^. RawTransactionCode, tx E.^. RawTransactionAttribution),
          (tx E.^. RawTransactionGasPrice, tx E.^. RawTransactionValue, tx E.^. RawTransactionTxData, tx E.^. RawTransactionMaxPriorityFeePerGas))
      let transaction (_, (E.Value nonce', E.Value gas, E.Value cid, E.Value r', E.Value s', E.Value v', E.Value txVersion),
            (E.Value to', E.Value func, E.Value cname, E.Value args', E.Value net, E.Value code', E.Value attr),
            (E.Value gasprice, E.Value value', E.Value txdata, E.Value priority)) = case (to', func, cname, code', args') of
              (Just dest, Just fn, Nothing, Nothing, _) -> MessageTX nonce' gas dest fn args' net cid r' s' v' txVersion (fromMaybe B.empty attr)
              (Nothing, Nothing, Just contract, Just source, _) -> ContractCreationTX nonce' gas contract args' net source cid r' s' v' txVersion
              (_, Nothing, Nothing, Nothing, []) -> EthereumTX nonce' (fromMaybe 0 gasprice) gas to' (fromMaybe 0 value') (fromMaybe B.empty txdata) cid r' s' v' txVersion (fromMaybe 0 priority)
              _ -> error "invalid stored transaction shape"
          txs = M.fromListWith (++) [(E.unValue key, [transaction row]) | row@(key, _, _, _) <- rows]
      return $ M.fromList [(E.unValue sha, reverse $ M.findWithDefault [] (E.unValue key) txs) | (key, sha) <- blocks]) pool
