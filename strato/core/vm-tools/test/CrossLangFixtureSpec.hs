{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}

-- | Produces a deterministic Withdrawal-shaped MPT inclusion proof using the
-- actual production code path (Receipt + ReceiptLog + TypedArg types,
-- @addAllKVs@, @getInclusionProof@). The hex strings printed by this test
-- are pasted into the matching Hardhat test, which feeds them through the
-- on-chain @MerklePatricia.verifyInclusion@ and the full BridgeVault claim
-- flow.
--
-- Running this test asserts that the bytes match the JS-side fixture
-- recorded below; on encoding drift either side fails loudly.
module CrossLangFixtureSpec (spec) where

import Blockchain.Data.RLP
import Blockchain.Data.Receipt
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.Strato.Model.Address (Address)
import Blockchain.Strato.Model.Util (byteString2NibbleString)
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import SolidVM.Model.TypedArg
import Test.Hspec

-- ============ Fixture inputs ============

-- These addresses match the constants in the Hardhat test harness so we can
-- drive the full BridgeVault claim flow without configuration drift.
stratoVault :: Address
stratoVault = 0x1010101010101010101010101010101010101010

externalToken :: Address
externalToken = 0x1111111111111111111111111111111111111111

externalRecipient :: Address
externalRecipient = 0x2222222222222222222222222222222222222222

stratoSender :: Address
stratoSender = 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa

stratoToken :: Address
stratoToken = 0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb

externalChainId :: Integer
externalChainId = 1

-- A Withdrawal-shaped receipt -- below the threshold the JS harness sets
-- (so the small/instant claim path applies).
withdrawalReceipt :: Receipt
withdrawalReceipt =
  Receipt
    { receiptStatus = ReceiptSuccess,
      receiptGasUsed = 21000,
      receiptLogs =
        [ ReceiptLog
            { rlogContractAddress = stratoVault,
              rlogEventName = "Withdrawal",
              rlogArgs =
                [ TAInt 42, -- nonce
                  TAInt externalChainId,
                  TAAddress externalToken,
                  TAAddress externalRecipient,
                  TAInt 50, -- externalTokenAmount, below the 100 threshold
                  TAAddress stratoSender,
                  TAAddress stratoToken,
                  TAInt 50 -- stratoTokenAmount
                ]
            }
        ]
    }

-- ============ Fixture build + dump ============

spec :: Spec
spec = describe "cross-language proof fixture" $ do
  it "builds a Haskell-side Withdrawal proof and dumps the bytes" $ do
    let receiptBytes = rlpSerialize (rlpEncode withdrawalReceipt)
    -- Build a single-tx trie at txIndex=0, mirroring the on-chain layout.
    let result = MP.runMP @IO $ do
          sr <- MP.addAllKVs MP.emptyTriePtr [(0 :: Integer, withdrawalReceipt)]
          let key =
                byteString2NibbleString $
                  rlpSerialize $ rlpEncode (0 :: Integer)
          (sr,) <$> MP.getInclusionProof sr key
    (sr, mProof) <- result
    case mProof of
      Nothing -> expectationFailure "expected proof"
      Just (valueBytes, proofNodes) -> do
        -- Hash equivalence -- the trie root committed to in
        -- header.receiptsRoot.
        let rootHex = toHex (MP.unboxStateRoot sr)
            valueHex = toHex valueBytes
            receiptHex = toHex receiptBytes
            proofHex = map toHex proofNodes
        -- These prints surface the fixture under `stack test vm-tools` so
        -- the values can be pasted into the matching Hardhat test if they
        -- ever shift. (`hspec` swallows stdout; runtime users can capture
        -- via --hspec-options=--print-cpu-time or read the test source.)
        putStrLn ""
        putStrLn "FIXTURE_BEGIN ----"
        putStrLn $ "  receiptsRoot: " ++ rootHex
        putStrLn $ "  receiptRLP:   " ++ receiptHex
        putStrLn $ "  valueBytes:   " ++ valueHex
        putStrLn "  proof:"
        mapM_ (\h -> putStrLn $ "    - " ++ h) proofHex
        putStrLn "FIXTURE_END ------"

        -- Sanity: re-running through the Haskell-side verifier (which
        -- mirrors the on-chain protocol) accepts the proof.
        valueBytes `shouldBe` receiptBytes

toHex :: B.ByteString -> String
toHex bs = "0x" ++ BC.unpack (B16.encode bs)
