{-# LANGUAGE OverloadedStrings #-}

import Blockchain.Data.LogsBloom
import Blockchain.Data.RLP
import Blockchain.Data.Transaction
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Code
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Secp256k1
import Control.Monad (forM_)
import Data.Bits (testBit)
import qualified Data.ByteString as B
import Data.List (sort)
import Data.Maybe (fromMaybe)
import Test.Hspec

-- | Bit indices set in a big-endian bloom (bit 0 = LSB of the last byte).
setBits :: B.ByteString -> [Int]
setBits bs =
  sort
    [ (B.length bs - 1 - byteIx) * 8 + bitInByte
    | byteIx <- [0 .. B.length bs - 1]
    , bitInByte <- [0 .. 7]
    , testBit (B.index bs byteIx) bitInByte
    ]

main :: IO ()
main = hspec $ spec >> nativeRLPChainIds >> nativeChainIdSigning

spec :: Spec
spec = describe "Blockchain.Data.LogsBloom" $ do
  it "produces a 256-byte filter" $
    B.length (bloomFromItems [B.empty]) `shouldBe` 256

  it "is all zeros for no logs" $
    computeLogsBloom [] `shouldBe` emptyLogsBloom

  it "emptyLogsBloom is 256 zero bytes" $
    (B.length emptyLogsBloom, B.all (== 0) emptyLogsBloom) `shouldBe` (256, True)

  -- keccak256("") = c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470
  -- first six bytes c5 d2 46 01 86 f7 give bit indices:
  --   (0xc5d2 & 2047)=1490, (0x4601 & 2047)=1537, (0x86f7 & 2047)=1783
  it "sets exactly the three Yellow-Paper bits for item = \"\"" $
    setBits (bloomFromItems [B.empty]) `shouldBe` [1490, 1537, 1783]

  it "OR-composes: union of two items equals combining their bits" $ do
    let a = B.pack [1, 2, 3]
        b = B.pack [4, 5, 6]
        combined = setBits (bloomFromItems [a, b])
        union' = sort (setBits (bloomFromItems [a]) ++ setBits (bloomFromItems [b]))
    combined `shouldBe` sort (foldr (\x acc -> if x `elem` acc then acc else x : acc) [] union')

nativeRLPChainIds :: Spec
nativeRLPChainIds = describe "Native RLP chain IDs" $ do
  let message cid ver attr = MessageTX 0 1000000 (Address 1) "ping" ["7"] "mercata" cid 0 0 27 ver attr
      transactions cid = [message cid ver attr | ver <- [0, 1], attr <- [B.empty, "attribution"]]
        ++ [ContractCreationTX 0 1000000 "Example" [] "mercata" (Code "contract Example {}") cid 0 0 27 ver | ver <- [0, 1]]
      roundTrip tx = rlpDecode $ rlpDeserialize $ rlpSerialize $ rlpEncode tx

  it "preserves chain IDs and recovery values in every native format" $
    forM_ [Nothing, Just 123354377739506, Just 195049586845898] $ \cid ->
      forM_ (transactions cid) $ \tx ->
        forM_ [27, 28] $ \recoveryV -> do
          let signed = tx {v = recoveryV}
          roundTrip signed `shouldBe` signed

  it "carries the chain ID in the existing signature v field" $
    forM_ [123354377739506, 195049586845898] $ \cid ->
      forM_ (transactions $ Just cid) $ \tx ->
        forM_ [27, 28] $ \recoveryV -> do
          let encoded = case rlpEncode tx {v = recoveryV} of
                RLPString bytes -> rlpDeserialize $ B.tail bytes
                payload -> payload
          case encoded of
            RLPArray items -> (rlpDecode (reverse items !! 2) :: Integer) `shouldBe` cid * 2 + 35 + toInteger (recoveryV - 27)
            _ -> expectationFailure "expected a native RLP payload"

  it "keeps legacy transaction bytes unchanged" $ do
    let legacy = B.pack
          [237, 2, 128, 131, 15, 66, 64, 148, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
           132, 112, 105, 110, 103, 193, 55, 135, 109, 101, 114, 99, 97, 116, 97, 27, 128, 128]
    rlpSerialize (rlpEncode $ message Nothing 0 B.empty) `shouldBe` legacy
    rlpEncode (message Nothing 1 B.empty) `shouldBe` RLPString (B.cons 1 legacy)

nativeChainIdSigning :: Spec
nativeChainIdSigning = describe "Native transaction chain IDs" $ do
  let message cid ver attr = MessageTX 0 1000000 (Address 1) "ping" ["7"] "mercata" cid 0 0 27 ver attr
      creation cid ver = ContractCreationTX 0 1000000 "Example" [] "mercata" (Code "contract Example {}") cid 0 0 27 ver
      transactions cid = [message cid 0 attr | attr <- [B.empty, "attribution"]]
        ++ [creation cid 0]
      roundTrip tx = rlpDecode $ rlpDeserialize $ rlpSerialize $ rlpEncode tx
      privateKey = fromMaybe (error "invalid test private key") $ importPrivateKey (B.replicate 31 0 <> B.singleton 1)
      expectedSigner = Just $ fromPublicKey $ derivePublicKey privateKey
      sign tx = let digest = keccak256ToByteString $ partialTransactionHash tx
                    (sr, ss, sv) = getSigVals $ signMsg privateKey digest
                in tx {r = toInteger sr, s = toInteger ss, v = sv}

  it "preserves legacy encoding and signing without a chain ID" $
    forM_ (transactions Nothing) $ \tx -> do
      roundTrip tx `shouldBe` tx
      whoSignedThisTransaction (roundTrip $ sign tx) `shouldBe` expectedSigner

  it "recovers chain-bound signatures after transmission" $
    forM_ (transactions $ Just 123354377739506) $ \tx ->
      whoSignedThisTransaction (roundTrip $ sign tx) `shouldBe` expectedSigner

  it "changing the signed chain ID changes the recovered signer" $
    forM_ (transactions $ Just 123354377739506) $ \tx ->
      whoSignedThisTransaction ((roundTrip $ sign tx) {chainId = Just 195049586845898}) `shouldNotBe` expectedSigner

  it "matches independently generated legacy and chain-bound RLP hashes" $ do
    partialTransactionHash (message Nothing 0 B.empty) `shouldBe`
      unsafeCreateKeccak256FromWord256 0x52e62c42d126963bbe1c53ec7cea4c6b68eb6f3efcbfdb7c353d62daea9a9ed8
    partialTransactionHash (message (Just 123354377739506) 0 B.empty) `shouldBe`
      unsafeCreateKeccak256FromWord256 0xdb17c9e7289340ee1ad7335d63a1a3036e72b2c48b5fd2ae2337d93660a3acbe
