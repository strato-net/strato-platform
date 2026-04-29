{-# LANGUAGE OverloadedStrings #-}

-- | Regression tests for the post-audit ABI codec strict path
-- ('parseTypeDescriptorStrict' / 'decodeValueStrict' / 'abiDecodeGated
-- True'). These cover audit findings 6, 12, 13, 26, 28 and 35 — all of
-- which are fork-gated, so we exercise the strict variant directly
-- here rather than going through the @MonadSM@ wrapper.
module BlockApps.Solidity.ABI.CodecAuditFixSpec (spec) where

import BlockApps.Solidity.ABI.Codec
import qualified Data.ByteString as B
import qualified Data.Vector as V
import Data.Word (Word8)
import SolidVM.Model.Value
import Test.Hspec

----------------------------------------------------------------------
-- helpers

-- | Encode a non-negative 'Integer' as a 32-byte big-endian word.
word32 :: Integer -> B.ByteString
word32 = padLeft32 . integerToBytesBE

-- | Encode a signed 'Integer' as a 32-byte big-endian word using
-- two's-complement (the layout abi.encode emits).
word32Signed :: Integer -> B.ByteString
word32Signed n
  | n >= 0    = word32 n
  | otherwise = word32 (n + 2 ^ (256 :: Int))

bytes :: [Word8] -> B.ByteString
bytes = B.pack

uintArg :: String -> Value
uintArg = SString

-- | Strip 'Constant' wrappers so we can compare element-wise.
unwrap :: Variable -> Value
unwrap (Constant v) = v
unwrap _            = SNULL  -- shouldn't happen in pure-decode tests

vecToList :: V.Vector a -> [a]
vecToList = V.toList

----------------------------------------------------------------------
-- spec

spec :: Spec
spec = do
  -- Audit finding 6: 'parseTypeDescriptorStrict' must reject widths
  -- that don't correspond to a real Solidity type (uint0, uint7,
  -- uint257, bytes33, ...). The legacy 'parseTypeDescriptor' accepts
  -- them.
  describe "Audit finding 6: parseTypeDescriptorStrict rejects invalid widths" $ do
    it "accepts valid uintN widths" $ do
      parseTypeDescriptorStrict "uint8"   `shouldBe` Just (TUint 8)
      parseTypeDescriptorStrict "uint64"  `shouldBe` Just (TUint 64)
      parseTypeDescriptorStrict "uint256" `shouldBe` Just (TUint 256)
      parseTypeDescriptorStrict "uint"    `shouldBe` Just (TUint 256)

    it "rejects uint0 / uint7 / uint12 / uint257" $ do
      parseTypeDescriptorStrict "uint0"   `shouldBe` Nothing
      parseTypeDescriptorStrict "uint7"   `shouldBe` Nothing
      parseTypeDescriptorStrict "uint12"  `shouldBe` Nothing  -- not multiple of 8
      parseTypeDescriptorStrict "uint257" `shouldBe` Nothing

    it "rejects intN with the same rules" $ do
      parseTypeDescriptorStrict "int8"    `shouldBe` Just (TInt 8)
      parseTypeDescriptorStrict "int0"    `shouldBe` Nothing
      parseTypeDescriptorStrict "int1000" `shouldBe` Nothing

    it "rejects bytesN outside [1,32]" $ do
      parseTypeDescriptorStrict "bytes1"  `shouldBe` Just (TBytesN 1)
      parseTypeDescriptorStrict "bytes32" `shouldBe` Just (TBytesN 32)
      parseTypeDescriptorStrict "bytes0"  `shouldBe` Nothing
      parseTypeDescriptorStrict "bytes33" `shouldBe` Nothing

    it "still parses dynamic arrays of valid element types" $ do
      parseTypeDescriptorStrict "uint8[]" `shouldBe` Just (TArrayOf (TUint 8))

    it "rejects dynamic arrays of invalid element types" $ do
      parseTypeDescriptorStrict "uint7[]" `shouldBe` Nothing

    it "preserves contrast with the legacy parser" $ do
      -- Legacy still accepts these so the fork-gated change is real:
      parseTypeDescriptor "uint7"   `shouldBe` Just (TUint 7)
      parseTypeDescriptor "uint257" `shouldBe` Just (TUint 257)
      parseTypeDescriptor "bytes33" `shouldBe` Just (TBytesN 33)

  -- Audit finding 13: 'decodeValueStrict' on a signed @intN<256@
  -- two's-complement-extends from N bits, not from 256. The legacy
  -- 'decodeValue' only checked the high bit at width 256, producing
  -- the wrong value for a negative narrow int.
  describe "Audit finding 13: intN<256 two's-complement decode" $ do
    it "decodes int8(-1) correctly post-audit" $ do
      -- 'abi.encode(int8(-1))' is a 32-byte word of 0xFF.
      let encoded = B.replicate 32 0xff
      decodeValueStrict (TInt 8) encoded 0 `shouldBe` SInteger (-1)

    it "decodes int8(127) (positive max) correctly" $ do
      let encoded = word32Signed 127
      decodeValueStrict (TInt 8) encoded 0 `shouldBe` SInteger 127

    it "decodes int8(-128) (negative min) correctly" $ do
      -- abi.encode(int8(-128)) sign-extends to 0xff..ff80.
      let encoded = B.replicate 31 0xff <> bytes [0x80]
      decodeValueStrict (TInt 8) encoded 0 `shouldBe` SInteger (-128)

  -- Audit finding 35: 'decodeValueStrict' must mask the decoded raw
  -- word to the declared width for narrow uintN, so an
  -- abi.encode(uint256(0x100)) treated as @uint8@ comes out as 0
  -- rather than 256.
  describe "Audit finding 35: uintN<256 width clamping" $ do
    it "uint8 truncates a 0x100 word to 0" $ do
      decodeValueStrict (TUint 8) (word32 0x100) 0 `shouldBe` SInteger 0
    it "uint8 keeps 0xff intact" $ do
      decodeValueStrict (TUint 8) (word32 0xff) 0 `shouldBe` SInteger 0xff
    it "uint16 truncates 0x10000 to 0" $ do
      decodeValueStrict (TUint 16) (word32 0x10000) 0 `shouldBe` SInteger 0
    it "uint256 is the identity (no clamp)" $ do
      decodeValueStrict (TUint 256) (word32 12345) 0 `shouldBe` SInteger 12345

  -- Audit finding 28: 'decodeValueStrict' must return SNULL on
  -- out-of-bounds reads instead of silently producing a zero-padded
  -- value (which the legacy 'decodeValue' did via 'B.take'/'B.drop'
  -- saturating-at-end semantics).
  describe "Audit finding 28: decodeValueStrict bounds checks" $ do
    it "uint at offset past end → SNULL" $ do
      decodeValueStrict (TUint 256) B.empty 0 `shouldBe` SNULL
      decodeValueStrict (TUint 256) (word32 1) 32 `shouldBe` SNULL

    it "negative offset → SNULL" $ do
      decodeValueStrict (TUint 256) (word32 1) (-1) `shouldBe` SNULL

    it "in-range offset still decodes normally" $ do
      decodeValueStrict (TUint 256) (word32 7) 0 `shouldBe` SInteger 7

  -- Audit finding 12: 'decodeValueStrict' for dynamic arrays must cap
  -- the length declared by the encoded prefix at remaining-bytes/32,
  -- so a hostile length prefix can't force the decoder to allocate
  -- gigabytes of SArray elements.
  describe "Audit finding 12: array length cap in decodeValueStrict" $ do
    it "well-formed two-element uint256[] decodes both elements" $ do
      let encoded = B.concat
            [ word32 32   -- pointer to length
            , word32 2    -- length
            , word32 11   -- element 0
            , word32 22   -- element 1
            ]
      case decodeValueStrict (TArrayOf (TUint 256)) encoded 0 of
        SArray vs ->
          map unwrap (vecToList vs)
            `shouldBe` [SInteger 11, SInteger 22]
        other -> expectationFailure $ "expected SArray; got " ++ show other

    it "hostile length prefix is capped to remaining-bytes/32" $ do
      -- Claim length = 2^32 but only one element of payload follows.
      let encoded = B.concat
            [ word32 32                  -- pointer
            , word32 (2 ^ (32 :: Int))   -- bogus length
            , word32 99                  -- single legit element
            ]
      case decodeValueStrict (TArrayOf (TUint 256)) encoded 0 of
        SArray vs -> do
          -- We don't pin the exact cap — just assert the decoder
          -- didn't blow up and produced *bounded* output (≤ remaining/32 = 1).
          V.length vs `shouldSatisfy` (\n -> n >= 0 && n <= 1)
        other -> expectationFailure $ "expected SArray; got " ++ show other

  -- Audit finding 26: 'abiDecodeGated' must use the strict path when
  -- 'True' is passed and the legacy path when 'False' is passed. We
  -- check by decoding the same input both ways and observing the
  -- masking difference on a uint8 with a violating word.
  describe "Audit finding 26: abiDecodeGated routes through the strict path" $ do
    let encoded = B.concat
          [ word32 0x100   -- "uint8" arg with width violation
          , word32 0x42    -- "uint16" arg
          ]

    it "abiDecodeGated False preserves legacy (silent overflow)" $ do
      case abiDecodeGated False encoded [uintArg "uint8", uintArg "uint16"] of
        STuple vs ->
          map unwrap (vecToList vs) `shouldBe` [SInteger 0x100, SInteger 0x42]
        other -> expectationFailure $ "expected STuple; got " ++ show other

    it "abiDecodeGated True clamps the narrow uint8 to its declared width" $ do
      case abiDecodeGated True encoded [uintArg "uint8", uintArg "uint16"] of
        STuple vs ->
          map unwrap (vecToList vs) `shouldBe` [SInteger 0x00, SInteger 0x42]
        other -> expectationFailure $ "expected STuple; got " ++ show other
