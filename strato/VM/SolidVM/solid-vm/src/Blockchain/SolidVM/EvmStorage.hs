{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}

-- | Bridge between EVM-style flat storage (Word256 → Word256) and
-- SolidVM's path-based storage (@[StoragePathPiece]@ → 'BasicValue').
--
-- The bridge is used by Yul's @sload@ / @sstore@ opcodes. Each contract
-- has an implicit slot layout: top-level scalar state variables are
-- assigned slots 0, 1, 2, ... in source-declaration order, mirroring
-- Solidity's rule for non-packed scalar types. Reads and writes to
-- those slots translate to SolidVM storage paths so Yul can
-- interoperate with Solidity code in the same contract.
--
-- Slots that don't correspond to a bridgeable state variable (mappings,
-- dynamic arrays, dynamic strings/bytes, structs) and arbitrary slots
-- (e.g. @keccak256(key . slot)@ derived ones) fall through to a
-- per-call-frame raw EVM-slot map (see 'CallInfo.evmStorage'). That is
-- enough for Yul code that operates in its own storage namespace and
-- for simple interop with scalar state variables.
--
-- Mapping and dynamic-array slot derivation is intentionally not
-- special-cased here; Yul code that does @sstore(keccak256(key . slot), v)@
-- simply writes to the corresponding raw slot, and Solidity code that
-- accesses @m[key]@ goes through its own path-based code path. The two
-- therefore do not see each other for dynamic collections. Fixing that
-- would require maintaining a reverse @keccak256@ slot → path table,
-- which is a larger follow-up.
module Blockchain.SolidVM.EvmStorage
  ( sload,
    sstore,
    sloadRef,
    sstoreRef,
    bridgeableStateVarSlots,
  )
where

import Blockchain.DB.SolidStorageDB (getSolidStorageKeyVal', putSolidStorageKeyVal')
import Blockchain.SolidVM.SM
import Blockchain.Strato.Model.Address (Address)
import Blockchain.Strato.Model.ExtendedWord (Word256, bytesToWord256, word256ToBytes)
import Control.Monad (when)
import Control.Monad.IO.Class (liftIO)
import Data.Bits (Bits (..), shiftL)
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import Data.IORef (IORef, atomicModifyIORef')
import qualified Data.List as L
import qualified Data.Map as M
import Data.Ord (comparing)
import Data.Source.Annotation (SourceAnnotation (..))
import qualified SolidVM.Model.CodeCollection as CC
import qualified SolidVM.Model.Storable as MS
import SolidVM.Model.SolidString (SolidString, labelToString)
import qualified SolidVM.Model.Type as SVMType

-- ---------------------------------------------------------------------------
-- Contract slot layout

-- | Top-level state variables that can be bridged to a direct EVM slot,
-- returned in declaration order (slot 0 first). Constants, immutables,
-- and types whose runtime layout is dynamic (mappings, dynamic arrays,
-- dynamic strings/bytes, structs) are skipped.
bridgeableStateVarSlots ::
  CC.ContractF (SourceAnnotation ()) ->
  [(SolidString, SVMType.Type)]
bridgeableStateVarSlots contract =
  let entries = M.toList (CC._storageDefs contract)
      ordered = L.sortBy (comparing declarationPos) entries
   in [ (name, CC._varType decl)
        | (name, decl) <- ordered,
          not (CC._isImmutable decl),
          bridgeableType (CC._varType decl)
      ]
  where
    declarationPos (_, decl) = _sourceAnnotationStart (CC._varContext decl)

-- | Whether a Solidity type has a stable, single-slot scalar runtime
-- representation that we can convert to/from a 'Word256'.
bridgeableType :: SVMType.Type -> Bool
bridgeableType = \case
  SVMType.Int {} -> True
  SVMType.Bool -> True
  SVMType.Address {} -> True
  SVMType.Bytes {SVMType.dynamic = Just False} -> True
  SVMType.Bytes {SVMType.dynamic = Nothing} -> True
  SVMType.Enum {} -> True
  SVMType.UserDefined _ actual -> bridgeableType actual
  _ -> False

lookupSlot ::
  Word256 ->
  CC.ContractF (SourceAnnotation ()) ->
  Maybe (SolidString, SVMType.Type)
lookupSlot slot contract
  | slot > fromIntegral (maxBound :: Int) = Nothing
  | otherwise =
    let ix = fromIntegral slot :: Int
        table = bridgeableStateVarSlots contract
     in if ix >= 0 && ix < length table
          then Just (table !! ix)
          else Nothing

-- ---------------------------------------------------------------------------
-- Raw EVM-slot map (IORef-backed)

sloadRef :: IORef (M.Map Word256 Word256) -> Word256 -> IO Word256
sloadRef ref slot = do
  m <- atomicModifyIORef' ref (\x -> (x, x))
  pure $ M.findWithDefault 0 slot m

sstoreRef :: IORef (M.Map Word256 Word256) -> Word256 -> Word256 -> IO ()
sstoreRef ref slot val =
  atomicModifyIORef' ref $ \m -> (M.insert slot val m, ())

-- ---------------------------------------------------------------------------
-- MonadSM-level sload / sstore with named-slot bridging

sload :: MonadSM m => Word256 -> m Word256
sload slot = do
  ci <- getCurrentCallInfo
  case lookupSlot slot (currentContract ci) of
    Just (name, ty) -> readNamedSlot (currentAddress ci) name ty
    Nothing -> liftIO $ sloadRef (evmStorage ci) slot

sstore :: MonadSM m => Word256 -> Word256 -> m ()
sstore slot val = do
  ci <- getCurrentCallInfo
  when (readOnly ci) $
    error "sstore: storage write inside a read-only call frame"
  case lookupSlot slot (currentContract ci) of
    Just (name, ty) -> writeNamedSlot (currentAddress ci) name ty val
    Nothing -> liftIO $ sstoreRef (evmStorage ci) slot val

-- ---------------------------------------------------------------------------
-- Named-slot read/write (scalar types only; dynamic types won't reach
-- this path because 'bridgeableType' filters them out).

readNamedSlot :: MonadSM m => Address -> SolidString -> SVMType.Type -> m Word256
readNamedSlot addr name ty = do
  let path = MS.fromList [MS.Field (BC.pack (labelToString name))]
  bv <- getSolidStorageKeyVal' addr path
  pure $ basicValueToWord256 ty bv

writeNamedSlot :: MonadSM m => Address -> SolidString -> SVMType.Type -> Word256 -> m ()
writeNamedSlot addr name ty val = do
  let path = MS.fromList [MS.Field (BC.pack (labelToString name))]
      bv = word256ToBasicValue ty val
  markDiffForAction addr path bv
  putSolidStorageKeyVal' addr path bv

basicValueToWord256 :: SVMType.Type -> MS.BasicValue -> Word256
basicValueToWord256 _ = \case
  MS.BInteger i -> fromInteger i
  MS.BBool b -> if b then 1 else 0
  MS.BAddress a -> fromIntegral a
  MS.BEnumVal _ _ w -> fromIntegral w
  MS.BBytes bs -> bytesToLeftPaddedWord bs
  MS.BString bs -> bytesToLeftPaddedWord bs
  MS.BContract _ a -> fromIntegral a
  MS.BDecimal _ -> 0
  MS.BDefault -> 0

word256ToBasicValue :: SVMType.Type -> Word256 -> MS.BasicValue
word256ToBasicValue ty val = case ty of
  SVMType.Int _ _ -> MS.BInteger (toInteger val)
  SVMType.Bool -> MS.BBool (val /= 0)
  SVMType.Address _ ->
    let mask = (1 `shiftL` 160) - 1 :: Integer
     in MS.BAddress (fromInteger (toInteger val .&. mask))
  SVMType.Bytes _ mSize ->
    let packed = word256ToBytes val
        n = maybe 32 fromIntegral mSize
     in MS.BBytes (B.take n packed)
  SVMType.Enum _ _ _ -> MS.BInteger (toInteger val)
  SVMType.UserDefined _ actual -> word256ToBasicValue actual val
  _ -> MS.BInteger (toInteger val)

bytesToLeftPaddedWord :: BC.ByteString -> Word256
bytesToLeftPaddedWord bs =
  let n = B.length bs
      padded = BC.replicate (max 0 (32 - n)) '\0' <> B.take 32 bs
   in bytesToWord256 padded
