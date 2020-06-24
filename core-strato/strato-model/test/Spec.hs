{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE MagicHash #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE ScopedTypeVariables #-}


import           Control.Monad
import qualified Crypto.Secp256k1                 as SEC
import qualified Data.Aeson                       as Ae
import           Data.Aeson.QQ
import qualified Data.Bits                        as Bits
import           Data.Binary
import qualified Data.ByteString                  as B
import qualified Data.ByteString.Base16           as B16
import qualified Data.ByteString.Short            as BSS
import qualified Data.ByteString.Char8            as C8
import           Data.Maybe
import           Data.Word ()
import           GHC.Exts
import           GHC.Integer.GMP.Internals
import           Test.Hspec
import           Test.QuickCheck

import           Blockchain.Data.RLP
import           Blockchain.ECDSA
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.ExtendedWord
import           Blockchain.Strato.Model.CodePtr
import           Blockchain.Strato.Model.Keccak256
import           Network.Haskoin.Internals        (BigWord(..))


import qualified Blockchain.ExtendedECDSA         as HK
import qualified Network.Haskoin.Crypto           as HK
import qualified Network.Haskoin.Internals        as HK




main :: IO ()
main = hspec spec


spec :: Spec
spec = do
  describe "fastSerialize" $ do
    it "works on 0" $ word256ToBytes 0 `shouldBe` B.replicate 32 0
    it "works on ff" $ word256ToBytes 0xff `shouldBe` (B.replicate 31 0 <> B.replicate 1 0xff)
    it "works of aabbccdd" $
      word256ToBytes 0xaabbccdd `shouldBe` (B.replicate 28 0 <> B.pack [0xaa, 0xbb, 0xcc, 0xdd])
    it "works on first large size" $
      word256ToBytes 0x887766554433221100 `shouldBe`
        (B.replicate 23 0 <> B.pack [0x88, 0x77, 0x66, 0x55, 0x44, 0x33, 0x22, 0x11, 0])

    it "works on mid size" $
      replicateM_ 1000 $
        word256ToBytes 0x60646359b0ecaf704caa6f35 `shouldBe` fst (B16.decode
              "000000000000000000000000000000000000000060646359b0ecaf704caa6f35")
    it "works on max" $
      word256ToBytes 0xffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100 `shouldBe`
        B.pack [0xff, 0xee, 0xdd, 0xcc, 0xbb, 0xaa, 0x99, 0x88, 0x77, 0x66, 0x55, 0x44, 0x33, 0x22,
                0x11, 0x00, 0xff, 0xee, 0xdd, 0xcc, 0xbb, 0xaa, 0x99, 0x88, 0x77, 0x66, 0x55, 0x44,
                0x33, 0x22, 0x11, 0x00]

    it "works on arbitrary word256" $ property $ \n ->
      word256ToBytes n `shouldBe` B.pack (slowWord256ToBytes n)

    it "works on small word256" $ do
        let input = BigWord (S# 1#)
        let want = B.replicate 31 0 <> B.replicate 1 1
        word256ToBytes input `shouldBe` want

  describe "fastDeserialize" $ do
    it "maintains Integer invariants" $ property $ \n ->
      let n' = bytesToWord256 . word256ToBytes $ n
      in I# (isValidInteger# (getBigWordInteger n')) `shouldBe` 1
    it "works on 99656985947821947480 (66 bits)" $ do
      let b = word256ToBytes 99656985947821947480
      bytesToWord256 b `shouldBe` slowBytesToWord256 (B.unpack b)
    it "works on 10291335769063634520 (63+\\epsilon bits)" $ do
      let b = word256ToBytes 10291335769063634520
      bytesToWord256 b `shouldBe` slowBytesToWord256 (B.unpack b)
    it "works on arbitrary serialized word256" $ property $ \n -> do
      let b = word256ToBytes n
      bytesToWord256 b `shouldBe` slowBytesToWord256 (B.unpack b)

  describe "fastLowByte" $ do
    let slowByte :: Word256 -> Word8
        slowByte n = fromIntegral $ n Bits..&. 0xff
    it "works on arbitrary word256" $ property $ \n ->
      fastWord256LSB n `shouldBe` slowByte n
    it "works on S# Word256" $ do
      fastWord256LSB (BigWord (S# 0x93342434#)) `shouldBe` 0x34

  describe "Address serialization" $ do
    it "should be fixed width" $ do
      addressToHex 0xdeadbeef `shouldBe`
                    "00000000000000000000000000000000deadbeef"
      addressToHex 0 `shouldBe` C8.replicate 40 '0'
      addressToHex 0xca35b7d915458ef540ade6068dfe2f44e8fa733c `shouldBe`
                    "ca35b7d915458ef540ade6068dfe2f44e8fa733c"

  describe "CodePtr parsing" $ do
    let parse :: Ae.Value -> Either String CodePtr
        parse = Ae.eitherDecode . Ae.encode
    it "can parse legacy digests" $
      parse [aesonQQ|"ebe299430c3281dd37a12fbc6fda1f5ad3875242b413c4b46100676df78176b1"|]
        `shouldBe` Right (EVMCode $ unsafeCreateKeccak256FromWord256 0xebe299430c3281dd37a12fbc6fda1f5ad3875242b413c4b46100676df78176b1)

    it "can parse evm object digests" $
      parse [aesonQQ|{"kind": "EVM",
                      "digest": "ebe299430c3281dd37a12fbc6fda1f5ad3875242b413c4b46100676df78176b1"}|]
        `shouldBe` Right (EVMCode $ unsafeCreateKeccak256FromWord256 0xebe299430c3281dd37a12fbc6fda1f5ad3875242b413c4b46100676df78176b1)

    it "can parse solidvm object digests" $
      parse [aesonQQ|{"kind": "SolidVM", "name": "SimpleStorage",
                      "digest": "ebe299430c3281dd37a12fbc6fda1f5ad3875242b413c4b46100676df78176b1"}|]
        `shouldBe` Right (SolidVMCode "SimpleStorage"
                            $ unsafeCreateKeccak256FromWord256 0xebe299430c3281dd37a12fbc6fda1f5ad3875242b413c4b46100676df78176b1)

    it "round trips correctly" $ property $ \(ptr::CodePtr) -> do
      Ae.eitherDecode (Ae.encode ptr) `shouldBe` Right ptr

  describe "ECDSA operations (using secp256k1-haskell)" $ do
    let mPrv = importPrivateKey $ fst $ B16.decode $ C8.pack $ "09e910621c2e988e9f7f6ffcd7024f54ec1461fa6e86a4b545e9e1fe21c28866"
        prv = fromMaybe (error "could not import private key") mPrv
        pub = derivePublicKey prv 
        mesg = keccak256ToByteString $ hash $ C8.pack "hey guys!" 
        sig = signMsg prv mesg
   
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
    
    it "can recover public keys from signatures" $ do
      let mRecPub = recoverPub sig mesg
      (Just pub) `shouldBe` mRecPub
  
  describe "the ECDSA module works exactly like Haskoin on test values" $ do
    let testPrivBS = fst $ B16.decode $ C8.pack $ "09e910621c2e988e9f7f6ffcd7024f54ec1461fa6e86a4b545e9e1fe21c28866"
        hkPriv = fromMaybe (error "couldn't get HK key") $ HK.decodePrvKey HK.makePrvKey testPrivBS
        ecPriv = fromMaybe (error "couldn't get EC key") $ importPrivateKey testPrivBS
    
    it "can derive the same Ethereum address" $ do
      let hkAddr = prvKey2Address hkPriv
          ecAddr = fromPrivateKey ecPriv
      hkAddr `shouldBe` ecAddr
    
    it "can create the same ECDSA recoverable signature" $ do
      let mesg = hash $ C8.pack "hey guys!"
          (HK.ExtendedSignature (HK.Signature hr hs) hv) = HK.detExtSignMsg (keccak256ToWord256 mesg) hkPriv
          (Signature (SEC.CompactRecSig er es ev)) = signMsg ecPriv $ keccak256ToByteString mesg
          hkSigVals = [ word256ToBytes $ fromIntegral hr
                      , word256ToBytes $ fromIntegral hs
                      ]
          ecSigVals = [ BSS.fromShort $ er
                      , BSS.fromShort $ es
                      ]
          hvInt = (if hv then 28 else 27) :: Integer
          ecInt = toInteger ev
      hkSigVals `shouldBe` ecSigVals
      hvInt `shouldBe` ecInt
    
    it "can recover the same address from a signature" $ do
      let mesg = hash $ C8.pack "hey guys!"
          hkMsg = keccak256ToWord256 mesg
          ecMsg = keccak256ToByteString mesg
          hkSig = HK.detExtSignMsg hkMsg hkPriv
          ecSig = signMsg ecPriv ecMsg
          hkPub = fromMaybe (error "couldn't recover haskoin sig") (HK.getPubKeyFromSignature hkSig hkMsg)
          ecPub = fromMaybe (error "couldn't recover ec sig") (recoverPub ecSig ecMsg)
      fromPublicKey ecPub `shouldBe` pubKey2Address hkPub

