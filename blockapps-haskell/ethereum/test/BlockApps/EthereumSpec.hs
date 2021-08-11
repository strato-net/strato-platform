{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE OverloadedStrings, TypeApplications #-}

module BlockApps.EthereumSpec where

import Control.Applicative (liftA2)
import Data.Aeson
import Test.Hspec
import Test.Hspec.QuickCheck
import Test.QuickCheck
import Text.Read
import Web.FormUrlEncoded
import Web.HttpApiData

import BlockApps.Ethereum
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256 hiding (hash)

spec :: Spec
spec = modifyMaxSuccess (const 10) $ do

  describe "Word256" $ do
    it "shows correctly" $ do
      show (0x0 :: Word256) `shouldBe` "0"
      show (0x7 :: Word256) `shouldBe` "7"
      show (0x45 :: Word256) `shouldBe` "69"

    it "renders json correctly" $ do
      encode (0x0 :: Word256) `shouldBe` "\"0000000000000000000000000000000000000000000000000000000000000000\""
      encode (0x7 :: Word256) `shouldBe` "\"0000000000000000000000000000000000000000000000000000000000000007\""
      encode (0x45 :: Word256) `shouldBe` "\"0000000000000000000000000000000000000000000000000000000000000045\""

  describe "Hex" $ do
    prop "has inverse JSON decode/encode" $ jsonProp @ (Hex Word)
    prop "has inverse read/show" $ readShowProp @ (Hex Word)

  describe "Address" $ do
    prop "has inverse JSON decode/encode" $ jsonProp @ Address
    prop "has inverse HTTP Api Data decode/encode" $ httpApiDataProp @ Address
    prop "has inverse Form Url decode/encode" $ formProp @ Address
    prop "has inverse String decode/encode" $ \ address ->
      stringAddress (formatAddressWithoutColor address) === Just address

  describe "Keccak256" $ do
    prop "has inverse JSON decode/encode" $ jsonProp @ Keccak256
    prop "has inverse HTTP Api Data decode/encode" $
      httpApiDataProp @ Keccak256
    prop "has inverse Form Url decode/encode" $ formProp @ Keccak256
    prop "has inverse String decode/encode" $ \ hash ->
      stringKeccak256 (formatKeccak256WithoutColor hash) === Just hash


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
