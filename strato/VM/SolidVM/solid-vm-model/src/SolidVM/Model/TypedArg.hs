{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TupleSections #-}

-- | Canonical, typed RLP encoding of a SolidVM event argument.
--
-- The Phase 0 spec for proof-based bridge withdrawals
-- (proof-based-withdrawals-phase0.md, §6.3) calls for each event arg to be
-- RLP-encoded according to its Solidity type:
--
--   address       -> 20-byte string
--   uint/int      -> RLP integer (minimal big-endian)
--   bool          -> RLP integer 0 or 1
--   string/bytes  -> RLP byte string
--   array/struct  -> nested RLP list
--
-- The encoding carries no self-describing tag: the on-chain Solidity verifier
-- knows the event ABI and decodes each slot using the appropriate primitive
-- decoder. This keeps the wire format minimal and avoids the gas-costly
-- string-parsing that would otherwise be required.
--
-- Because the encoding isn't self-describing, RLP decode in Haskell isn't
-- generally invertible without a schema (Type) — `rlpDecode` below errors out
-- by design. Decoding happens on the verifier side, in Solidity, against a
-- known event signature.
module SolidVM.Model.TypedArg
  ( TypedArg (..),
    valueToTypedArg,
  )
where

import Blockchain.Data.RLP
import Blockchain.Strato.Model.Address
import Control.DeepSeq (NFData)
import Control.Monad.IO.Class (MonadIO, liftIO)
import qualified Data.ByteString as B
import Data.IORef (readIORef)
import qualified Data.Map as M
import Data.Maybe (catMaybes)
import qualified Data.Text as T
import Data.Text.Encoding (encodeUtf8)
import qualified Data.Vector as V
import GHC.Generics (Generic)
import SolidVM.Model.Value (Value (..), Variable (..))

data TypedArg
  = -- | Signed or unsigned integer. Minimal big-endian via RLP integer encoding.
    TAInt Integer
  | -- | Boolean. Encoded as integer 0 or 1.
    TABool Bool
  | -- | 20-byte Ethereum address.
    TAAddress Address
  | -- | UTF-8 string.
    TAString String
  | -- | Raw byte string.
    TABytes B.ByteString
  | -- | Homogeneous or heterogeneous array. Nested RLP list.
    TAArray [TypedArg]
  | -- | Struct value, encoded by-position (field names dropped from the trie
    -- representation since the verifier has the schema). The Haskell side
    -- keeps names for debugging convenience.
    TAStruct [(String, TypedArg)]
  deriving (Eq, Show, Generic, NFData)

instance RLPSerializable TypedArg where
  rlpEncode (TAInt i) = rlpEncode i
  rlpEncode (TABool b) = rlpEncode (if b then 1 :: Integer else 0)
  rlpEncode (TAAddress a) = rlpEncode a
  rlpEncode (TAString s) = rlpEncode (encodeUtf8 (T.pack s))
  rlpEncode (TABytes bs) = rlpEncode bs
  rlpEncode (TAArray xs) = RLPArray (map rlpEncode xs)
  rlpEncode (TAStruct fields) = RLPArray [rlpEncode v | (_, v) <- fields]

  -- Decode picks a coarse default interpretation since the encoding is
  -- intentionally not self-describing. RLPScalar -> TAInt, RLPString ->
  -- TABytes, RLPArray -> TAArray. Adequate for Haskell-side debugging and
  -- round-trip-as-bytes tests; the authoritative decode happens in the
  -- Solidity verifier against a known event schema.
  rlpDecode (RLPScalar n) = TAInt (fromIntegral n)
  rlpDecode (RLPString bs) = TABytes bs
  rlpDecode (RLPArray xs) = TAArray (map rlpDecode xs)

-- | Convert a SolidVM 'Value' to its canonical 'TypedArg'.
--
-- Primitives map directly. Aggregates (SArray, SStruct, STuple) hold
-- IORef-backed 'Variable's that we dereference under MonadIO; this
-- runs at receipt-build time when the post-execution snapshot is
-- already settled, so the result is deterministic across nodes.
--
-- Mappings (SMap) and reference-y / unrepresentable values (SFunction,
-- SBuiltinVariable, SNULL, …) intentionally produce 'Nothing'. Solidity
-- itself bans mappings in event args, so excluding them here is a
-- semantic rather than incidental restriction.
valueToTypedArg :: MonadIO m => Value -> m (Maybe TypedArg)
valueToTypedArg v = case v of
  SInteger i -> pure $ Just (TAInt i)
  SBool b -> pure $ Just (TABool b)
  SAddress a _ -> pure $ Just (TAAddress a)
  SString s -> pure $ Just (TAString s)
  SBytes b -> pure $ Just (TABytes b)
  SEnumVal _ _ w32 -> pure $ Just (TAInt (fromIntegral w32))
  SArray vec -> do
    args <- traverse variableToTypedArg (V.toList vec)
    pure $ Just $ TAArray (catMaybes args)
  STuple vec -> do
    args <- traverse variableToTypedArg (V.toList vec)
    pure $ Just $ TAArray (catMaybes args)
  SStruct _ fields -> do
    let pairs = M.toList fields  -- Data.Map.toList is canonically ordered by key
    converted <- traverse (\(name, var) -> (name,) <$> variableToTypedArg var) pairs
    pure $ Just $ TAStruct [(n, ta) | (n, Just ta) <- converted]
  _ -> pure Nothing

-- | Resolve an aggregate's 'Variable' back to a 'TypedArg', reading
-- the IORef when present.
variableToTypedArg :: MonadIO m => Variable -> m (Maybe TypedArg)
variableToTypedArg (Variable ref) = liftIO (readIORef ref) >>= valueToTypedArg
variableToTypedArg (Constant val) = valueToTypedArg val
