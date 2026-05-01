{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}

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
import qualified Data.ByteString as B
import qualified Data.Text as T
import Data.Text.Encoding (encodeUtf8)
import GHC.Generics (Generic)
import SolidVM.Model.Value (Value (..))

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
-- Only primitive types are supported. Aggregate types (SArray, SMap, SStruct,
-- STuple) contain 'Variable's backed by IORefs, which can't be dereferenced
-- in a pure context. The bridge 'Withdrawal' event uses only primitives, so
-- this is sufficient for the receipts-trie use case. If aggregate event args
-- become necessary, the conversion site (event emit) will need to freeze the
-- aggregate inside MonadSM and store the frozen form alongside the live
-- 'Value' on 'Event'.
valueToTypedArg :: Value -> Maybe TypedArg
valueToTypedArg v = case v of
  SInteger i -> Just (TAInt i)
  SBool b -> Just (TABool b)
  SAddress a _ -> Just (TAAddress a)
  SString s -> Just (TAString s)
  SBytes b -> Just (TABytes b)
  SEnumVal _ _ w32 -> Just (TAInt (fromIntegral w32))
  -- Aggregates and reference-y values intentionally fall through.
  _ -> Nothing
