{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE OverloadedStrings, TypeApplications #-}

module BlockApps.EthereumSpec where

import Control.Applicative (liftA2)
import Crypto.Secp256k1
import Data.Aeson
import qualified Data.ByteString.Base16 as Base16
import Data.RLP
import Test.Hspec
import Test.Hspec.QuickCheck
import Test.QuickCheck
import Text.Read
import Web.FormUrlEncoded
import Web.HttpApiData

import BlockApps.Ethereum

spec :: Spec
spec = modifyMaxSuccess (const 10) $ do

  describe "Hex" $ do
    prop "has inverse JSON decode/encode" $ jsonProp @ (Hex Word)
    prop "has inverse read/show" $ readShowProp @ (Hex Word)

  describe "Address" $ do
    prop "has inverse JSON decode/encode" $ jsonProp @ Address
    prop "has inverse HTTP Api Data decode/encode" $ httpApiDataProp @ Address
    prop "has inverse Form Url decode/encode" $ formProp @ Address
    prop "has inverse String decode/encode" $ \ address ->
      stringAddress (addressString address) === Just address

  describe "Keccak256" $ do
    prop "has inverse JSON decode/encode" $ jsonProp @ Keccak256
    prop "has inverse HTTP Api Data decode/encode" $
      httpApiDataProp @ Keccak256
    prop "has inverse Form Url decode/encode" $ formProp @ Keccak256
    prop "has inverse String decode/encode" $ \ hash ->
      stringKeccak256 (keccak256String hash) === Just hash

  let
    Just key1 = secKey . fst $ Base16.decode
      "c85ef7d79691fe79573b1a7064c19c1a9819ebdbd1faaab1a8ec92344438aaf4"
    Just key2 = secKey . fst $ Base16.decode
      "c87f65ff3f271bf5dc8643484f66b200109caffe4bf98c4cb393dc35740b28c0"

  describe "deriveAddress" $
    it "correctly derives address from key" $ do
      deriveAddress (derivePubKey key1) `shouldBe`
        Address 0xcd2a3d9f938e13cd947ec05abc7fe734df8dd826
      deriveAddress (derivePubKey key2) `shouldBe`
        Address 0x13978aee95f38490e9769c39b2773ed763d9cd5f

  let
    Right unsigned1 = rlpDeserialize . fst $ Base16.decode "e88085e8d4a510008227109413978aee95f38490e9769c39b2773ed763d9cd5f872386f26fc1000080"
    Right signed1 = rlpDeserialize . fst $ Base16.decode "f86b8085e8d4a510008227109413978aee95f38490e9769c39b2773ed763d9cd5f872386f26fc10000801ba0eab47c1a49bf2fe5d40e01d313900e19ca485867d462fe06e139e3a536c6d4f4a014a569d327dcda4b29f74f93c0e9729d2f49ad726e703f9cd90dbb0fbf6649f1"
    Right unsigned2 = rlpDeserialize . fst $ Base16.decode "f83c8085e8d4a510008227108080af6025515b525b600a37f260003556601b596020356000355760015b525b54602052f260255860005b525b54602052f2"
    Right signed2 = rlpDeserialize . fst $ Base16.decode "f87f8085e8d4a510008227108080af6025515b525b600a37f260003556601b596020356000355760015b525b54602052f260255860005b525b54602052f21ba05afed0244d0da90b67cf8979b0f246432a5112c0d31e8d5eedd2bc17b171c694a0bb1035c834677c2e1185b8dc90ca6d1fa585ab3d7ef23707e1a497a98e752d1b"

  describe "sign transaction" $ do
    prop "Public keys can be recovered after signing" $ \u -> do
      p <- newSecKey
      let t = signTransaction p u
          pub = derivePubKey p
      t `shouldSatisfy` verifyTransaction (derivePubKey p)
      t `shouldSatisfy` (== Just pub) . recoverTransaction
    it "correctly signs transaction (1)" $ do
      let
        unsigned1' = UnsignedTransaction
          { unsignedTransactionNonce = Nonce 0
          , unsignedTransactionGasPrice = Wei 1000000000000
          , unsignedTransactionGasLimit = Gas 10000
          , unsignedTransactionTo = Just (Address 0x13978aee95f38490e9769c39b2773ed763d9cd5f)
          , unsignedTransactionValue = Wei 10000000000000000
          , unsignedTransactionInitOrData = ""
          , unsignedTransactionChainId = Nothing
          }
        signed1' = signTransaction key1 unsigned1'
      unsigned1' `shouldBe` unsigned1
      signed1' `shouldSatisfy` verifyTransaction (derivePubKey key1)
      recoverTransaction signed1' `shouldBe` Just (derivePubKey key1)
      recoverTransaction signed1' `shouldBe` recoverTransaction signed1
    it "correctly signs transaction (2)" $ do
      let
        unsigned2' = UnsignedTransaction
          { unsignedTransactionNonce = Nonce 0
          , unsignedTransactionGasPrice = Wei 1000000000000
          , unsignedTransactionGasLimit = Gas 10000
          , unsignedTransactionTo = Nothing
          , unsignedTransactionValue = Wei 0
          , unsignedTransactionInitOrData = fst $ Base16.decode "6025515b525b600a37f260003556601b596020356000355760015b525b54602052f260255860005b525b54602052f2"
          , unsignedTransactionChainId = Nothing
          }
        signed2' = signTransaction key2 unsigned2'
      unsigned2' `shouldBe` unsigned2
      signed2' `shouldSatisfy` verifyTransaction (derivePubKey key2)
      recoverTransaction signed2' `shouldBe` Just (derivePubKey key2)
      recoverTransaction signed2' `shouldBe` recoverTransaction signed2

-- helpers

jsonProp :: (Eq x, Show x, FromJSON x, ToJSON x) => x -> Property
jsonProp x = decode (encode x) === Just x

readShowProp :: (Eq x, Read x, Show x) => x -> Property
readShowProp = liftA2 (===) (readMaybe . show) Just

httpApiDataProp
  :: (Eq x, Show x, FromHttpApiData x, ToHttpApiData x) => x -> Property
httpApiDataProp x =
  parseQueryParam (toQueryParam x) === Right x
  .&&. parseUrlPiece (toUrlPiece x) === Right x
  .&&. parseHeader (toHeader x) === Right x

formProp :: (Eq x, Show x, FromForm x, ToForm x) => x -> Property
formProp x = fromForm (toForm x) === Right x
