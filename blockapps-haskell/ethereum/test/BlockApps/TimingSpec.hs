{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE OverloadedStrings, TypeApplications, BangPatterns #-}

module BlockApps.TimingSpec where

import Control.DeepSeq
import Crypto.HaskoinShim
import Data.Aeson
import qualified Data.ByteString.Base16 as Base16
import System.Clock
import Test.Hspec
import Test.Hspec.QuickCheck
import Test.QuickCheck
import Web.FormUrlEncoded
import Web.HttpApiData

import BlockApps.Ethereum
import Blockchain.Strato.Model.Address

spec :: Spec
spec = modifyMaxSuccess (const 10) $ do

  let
    Just key1 = secKey . fst $ Base16.decode
      "c85ef7d79691fe79573b1a7064c19c1a9819ebdbd1faaab1a8ec92344438aaf4"

  describe "Timing sign transaction" $ do
    it "correctly signs 1000 transactions" $ do
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
      let unsignedN = take 10000 $ map (\i -> unsigned1'{unsignedTransactionNonce = Nonce i}) [0..]
      t0 <- getTime Realtime
      let signed = map (signTransaction key1) unsignedN
      t1 <- signed `deepseq` getTime Realtime
      putStrLn $ "Time to sign 1000 transactions: " ++ show (toNanoSecs $ t1 - t0)
      let ver = flip map signed $ verifyTransaction (derivePubKey key1)
      ver `shouldSatisfy` all id
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
      let unsignedN = take 10000 $ map (\i -> unsigned2'{unsignedTransactionNonce = Nonce i}) [0..]
      t0 <- getTime Realtime
      let signed = map (signTransaction key1) unsignedN
      t1 <- signed `deepseq` getTime Realtime
      putStrLn $ "Time to sign 1000 transactions: " ++ show (toNanoSecs $ t1 - t0)
      let ver = flip map signed $ verifyTransaction (derivePubKey key1)
      ver `shouldSatisfy` all id

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
