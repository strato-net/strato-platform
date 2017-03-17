{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE OverloadedStrings, TypeApplications #-}

module BlockApps.EthereumSpec where

import Crypto.Secp256k1
import Data.Aeson
import qualified Data.ByteString.Base16 as Base16
import Test.Hspec
import Test.Hspec.QuickCheck
import Test.QuickCheck
import Web.FormUrlEncoded
import Web.HttpApiData

import BlockApps.Ethereum

spec :: Spec
spec = modifyMaxSuccess (const 10) $ do

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
    Just sk1 = secKey . fst $ Base16.decode
      "c85ef7d79691fe79573b1a7064c19c1a9819ebdbd1faaab1a8ec92344438aaf4"
    Just sk2 = secKey . fst $ Base16.decode
      "c87f65ff3f271bf5dc8643484f66b200109caffe4bf98c4cb393dc35740b28c0"

  describe "deriveAddress" $
    it
      "correctly derives address from key" $ do
      deriveAddress (derivePubKey sk1) `shouldBe`
        Address 0xcd2a3d9f938e13cd947ec05abc7fe734df8dd826
      deriveAddress (derivePubKey sk2) `shouldBe`
        Address 0x13978aee95f38490e9769c39b2773ed763d9cd5f

-- helpers

jsonProp :: (Eq x, Show x, FromJSON x, ToJSON x) => x -> Property
jsonProp x = decode (encode x) === Just x

httpApiDataProp
  :: (Eq x, Show x, FromHttpApiData x, ToHttpApiData x) => x -> Property
httpApiDataProp x =
  parseQueryParam (toQueryParam x) === Right x
  .&&. parseUrlPiece (toUrlPiece x) === Right x
  .&&. parseHeader (toHeader x) === Right x

formProp :: (Eq x, Show x, FromForm x, ToForm x) => x -> Property
formProp x = fromForm (toForm x) === Right x
