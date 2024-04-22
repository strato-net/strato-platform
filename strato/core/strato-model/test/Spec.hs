{-# LANGUAGE MagicHash #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE PackageImports #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE ScopedTypeVariables #-}

-- import           GHC.Integer.GMP.Internals
-- import           GHC.Num.BigNat

import Blockchain.Data.RLP
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainMember
import Blockchain.Strato.Model.CodePtr
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Secp256k1 as SEC
import Control.Monad
import qualified Data.Aeson as Ae
import Data.Aeson.QQ
import Data.Binary
import qualified Data.Bits as Bits
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as C8
import Data.Maybe
import Data.Ranged
import qualified Data.Text as T
import Data.Word ()
import Database.Persist.Sql
import GHC.Exts
import GHC.Num.Integer
import qualified LabeledError
import Network.Haskoin.Crypto.BigWord (BigWord (..))
import Numeric (showHex)
import Test.Hspec
import Test.QuickCheck

main :: IO ()
main = hspec spec

spec :: Spec
spec = do
  describe "ChainMemberRSets" $ do
    it "can simplify RSets" $ do
      let ChainMemberRSet ba = snd . chainMemberParsedSetToChainMemberRSet $ Org "BlockApps" True
          ChainMemberRSet baEng = snd . chainMemberParsedSetToChainMemberRSet $ OrgUnit "BlockApps" "Engineering" True
          ChainMemberRSet ms = snd . chainMemberParsedSetToChainMemberRSet $ Org "Microsoft" True
          unionLBA = rSetUnion ba baEng
          unionRBA = rSetUnion baEng ba
          unionBAMS = ba `rSetUnion` ms `rSetUnion` baEng
          intersectionLBA = rSetIntersection ba baEng
          intersectionRBA = rSetIntersection baEng ba
      unionLBA `shouldBe` ba
      unionRBA `shouldBe` ba
      intersectionLBA `shouldBe` baEng
      intersectionRBA `shouldBe` baEng
      unionBAMS `shouldBe` (ba `rSetUnion` ms)
    it "can simplify RSets" $ do
      let ChainMemberRSet ba = snd . chainMemberParsedSetToChainMemberRSet $ CommonName "BlockApps" "Engineering" "Dustin Norwood" True
          ChainMemberRSet ba' = snd . chainMemberParsedSetToChainMemberRSet $ CommonName "BlockApps" "Engineering" "Dustin Norwood" False
          ChainMemberRSet ms = snd . chainMemberParsedSetToChainMemberRSet $ Org "Microsoft" True
          unionLBA = rSetUnion ba ms
          intersectionLBA = rSetIntersection unionLBA ba'
      intersectionLBA `shouldBe` ms
  describe "fastSerialize" $ do
    it "works on 0" $ word256ToBytes 0 `shouldBe` B.replicate 32 0
    it "works on ff" $ word256ToBytes 0xff `shouldBe` (B.replicate 31 0 <> B.replicate 1 0xff)
    it "works of aabbccdd" $
      word256ToBytes 0xaabbccdd `shouldBe` (B.replicate 28 0 <> B.pack [0xaa, 0xbb, 0xcc, 0xdd])
    it "works on first large size" $
      word256ToBytes 0x887766554433221100
        `shouldBe` (B.replicate 23 0 <> B.pack [0x88, 0x77, 0x66, 0x55, 0x44, 0x33, 0x22, 0x11, 0])

    it "works on mid size" $
      replicateM_ 1000 $
        word256ToBytes 0x60646359b0ecaf704caa6f35
          `shouldBe` ( LabeledError.b16Decode
                         "strato-model/Spec.hs"
                         "000000000000000000000000000000000000000060646359b0ecaf704caa6f35"
                     )
    it "works on max" $
      word256ToBytes 0xffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100
        `shouldBe` B.pack
          [ 0xff,
            0xee,
            0xdd,
            0xcc,
            0xbb,
            0xaa,
            0x99,
            0x88,
            0x77,
            0x66,
            0x55,
            0x44,
            0x33,
            0x22,
            0x11,
            0x00,
            0xff,
            0xee,
            0xdd,
            0xcc,
            0xbb,
            0xaa,
            0x99,
            0x88,
            0x77,
            0x66,
            0x55,
            0x44,
            0x33,
            0x22,
            0x11,
            0x00
          ]

    it "works on arbitrary word256" $
      property $ \n ->
        word256ToBytes n `shouldBe` B.pack (slowWord256ToBytes n)

    it "works on small word256" $ do
      let input = BigWord (IS 1#)
      let want = B.replicate 31 0 <> B.replicate 1 1
      word256ToBytes input `shouldBe` want

  describe "fastDeserialize" $ do
    it "maintains Integer invariants" $
      property $ \n ->
        let n' = bytesToWord256 . word256ToBytes $ n
         in I# (integerCheck# (getBigWordInteger n')) `shouldBe` 1
    it "works on 99656985947821947480 (66 bits)" $ do
      let b = word256ToBytes 99656985947821947480
      bytesToWord256 b `shouldBe` slowBytesToWord256 (B.unpack b)
    it "works on 10291335769063634520 (63+\\epsilon bits)" $ do
      let b = word256ToBytes 10291335769063634520
      bytesToWord256 b `shouldBe` slowBytesToWord256 (B.unpack b)
    it "works on arbitrary serialized word256" $
      property $ \n -> do
        let b = word256ToBytes n
        bytesToWord256 b `shouldBe` slowBytesToWord256 (B.unpack b)

  describe "fastLowByte" $ do
    let slowByte :: Word256 -> Word8
        slowByte n = fromIntegral $ n Bits..&. 0xff
    it "works on arbitrary word256" $
      property $ \n ->
        fastWord256LSB n `shouldBe` slowByte n
    it "works on S# Word256" $ do
      fastWord256LSB (BigWord (IS 0x93342434#)) `shouldBe` 0x34

  describe "Address serialization" $ do
    it "should be fixed width" $ do
      addressToHex 0xdeadbeef
        `shouldBe` "00000000000000000000000000000000deadbeef"
      addressToHex 0 `shouldBe` C8.replicate 40 '0'
      addressToHex 0xca35b7d915458ef540ade6068dfe2f44e8fa733c
        `shouldBe` "ca35b7d915458ef540ade6068dfe2f44e8fa733c"

  describe "CodePtr parsing" $ do
    let parse :: Ae.Value -> Either String CodePtr
        parse = Ae.eitherDecode . Ae.encode
    it "can parse legacy digests" $
      parse [aesonQQ|"ebe299430c3281dd37a12fbc6fda1f5ad3875242b413c4b46100676df78176b1"|]
        `shouldBe` Right (ExternallyOwned $ unsafeCreateKeccak256FromWord256 0xebe299430c3281dd37a12fbc6fda1f5ad3875242b413c4b46100676df78176b1)

    it "can parse evm object digests" $
      parse
        [aesonQQ|{"kind": "EVM",
                      "digest": "ebe299430c3281dd37a12fbc6fda1f5ad3875242b413c4b46100676df78176b1"}|]
        `shouldBe` Right (ExternallyOwned $ unsafeCreateKeccak256FromWord256 0xebe299430c3281dd37a12fbc6fda1f5ad3875242b413c4b46100676df78176b1)

    it "can parse solidvm object digests" $
      parse
        [aesonQQ|{"kind": "SolidVM", "name": "SimpleStorage",
                      "digest": "ebe299430c3281dd37a12fbc6fda1f5ad3875242b413c4b46100676df78176b1"}|]
        `shouldBe` Right
          ( SolidVMCode "SimpleStorage" $
              unsafeCreateKeccak256FromWord256 0xebe299430c3281dd37a12fbc6fda1f5ad3875242b413c4b46100676df78176b1
          )

    it "round trips correctly" $
      property $ \(ptr :: CodePtr) -> do
        Ae.eitherDecode (Ae.encode ptr) `shouldBe` Right ptr

    it "can read a legacy code hash PersistValue" $
      property $ \(w :: Word256) -> do
        (fromPersistValue . PersistText . T.pack $ showHex w "")
          `shouldBe` Right (ExternallyOwned $ unsafeCreateKeccak256FromWord256 w)

    it "can read the legacy empty code hash PersistValue" $ do
      let codeHashStr = "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
          codeHashWord = 0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470
      (fromPersistValue $ PersistText codeHashStr)
        `shouldBe` Right (ExternallyOwned $ unsafeCreateKeccak256FromWord256 codeHashWord)

  describe "secp256k1 operations (using secp256k1-haskell)" $ do
    let mPrv = importPrivateKey $ LabeledError.b16Decode "strato-model/Spec.hs" $ C8.pack $ "09e910621c2e988e9f7f6ffcd7024f54ec1461fa6e86a4b545e9e1fe21c28866"
        prv = fromMaybe (error "could not import private key") mPrv
        pub = derivePublicKey prv
        mesg = keccak256ToByteString $ hash $ C8.pack "hey guys!"
        sig = signMsg prv mesg

    it "can export public key as SEC bytestring" $ do
      B.length (exportPublicKey False pub) `shouldBe` 65
    it "can convert public key to and from JSON encoding" $ do
      Ae.decode (Ae.encode pub) `shouldBe` Just pub
    it "can convert signature to and from JSON encoding" $ do
      Ae.decode (Ae.encode sig) `shouldBe` Just sig
    it "can convert signature to and from RLP encoding" $ do
      let encSig = rlpSerialize (rlpEncode sig)
      rlpDecode (rlpDeserialize encSig) `shouldBe` sig
    it "can convert signature to and from Binary encoding" $ do
      let encSig = encode sig
      decode encSig `shouldBe` sig
    it "can export and import signature as a bytestring" $ do
      let sigBS = exportSignature sig
      importSignature sigBS `shouldBe` (Right sig)
    it "arbitrary sigs can be exported/imported" $
      property $ \s -> do
        let sigBS = exportSignature s
        B.length sigBS `shouldBe` 65
        importSignature sigBS `shouldBe` (Right s)
    it "exported sigs can be used for recovery" $ do
      let sigBS = exportSignature sig
          sig' = importSignature sigBS
      case sig' of
        Left err -> error err
        Right sig'' -> recoverPub sig'' mesg `shouldBe` Just pub

    it "can recover public keys from signatures" $ do
      let mRecPub = recoverPub sig mesg
      (Just pub) `shouldBe` mRecPub

    -- It can verify signatures given a message and key

    it "can generate ECDH shared secret" $ do
      let mOtherPriv = importPrivateKey (LabeledError.b16Decode "strato-model/Spec.hs" $ C8.pack $ "2d5daffcc515a23155bc5b5d21f852ab2554e6cae0351c5561b44fad6931f62d")
          otherPriv = fromMaybe (error "could not import the other priv key") mOtherPriv
          otherPub = derivePublicKey otherPriv
          sec1 = deriveSharedKey prv otherPub
          sec2 = deriveSharedKey otherPriv pub
      sec1 `shouldBe` sec2

    it "test address derivation, signatures, and signature recovery on arbitrary private keys" $
      property $ \k -> do
        let sig' = signMsg k mesg
            pub' = derivePublicKey k
            add = fromPublicKey pub'
            mRecPub = recoverPub sig' mesg
        Just pub' `shouldBe` mRecPub
        fromPublicKey (fromJust mRecPub) `shouldBe` add
        fromPublicKey (fromJust mRecPub) `shouldBe` fromPrivateKey k
        fromPrivateKey k `shouldBe` add
