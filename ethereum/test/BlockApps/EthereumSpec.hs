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

  describe "deriveAddress" $
    it
      "correctly derives the address corresponding to an example secret key" $ do
      let
        Just sk = secKey . fst $ Base16.decode
          "cd244b3015703ddf545595da06ada5516628c5feadbf49dc66049c4b370cc5d8"
      deriveAddress (derivePubKey sk) `shouldBe`
        Address 0x89b44e4d3c81ede05d0f5de8d1a68f754d73d997

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
