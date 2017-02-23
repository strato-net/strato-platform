{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE OverloadedStrings, TypeApplications #-}

module BlockApps.EthereumSpec where

import Data.Aeson
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
