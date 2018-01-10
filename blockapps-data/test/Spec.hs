{-# LANGUAGE OverloadedStrings #-}
import           Control.Monad
import           Data.Aeson
import           Data.Aeson                      as Ae
import           Data.Aeson.Diff
import qualified Data.ByteString                 as B
import qualified Data.ByteString.Lazy.Char8      as C8
import qualified Data.ByteString.Base16          as B16
import qualified Data.Text                       as T
import qualified Data.Text.Encoding              as T
import           Test.Hspec

import           Blockchain.Data.Address
import           Blockchain.Strato.Model.ExtendedWord
import           Blockchain.Data.Json 

main :: IO()
main = hspec $ do
  describe "Data round trips" $ do
    forM_ testAddresses $ \input -> do
      it ("fromJSON . toJSON = id on address " ++ input) $ do
        let output = T.unpack . addressToString . stringToAddress $ input
        output `shouldBe` input
    rawtxRoundTrip
    blockDataRoundTrip
    txRoundTrip
    blocksRoundTrip

stringToAddress :: [Char] -> Address
stringToAddress x = Address
             $ bytesToWord160
             $ B.unpack
             $ fst . B16.decode
             $ T.encodeUtf8
             $ T.pack x

addressToString :: Address -> T.Text
addressToString address = let (String t) = toJSON address in t

testAddresses :: [String]
testAddresses = map (\i -> (take (40 - i) $ repeat '0') ++ (take i $ repeat 'a')) [0..40]

blocksRoundTrip :: Spec
blocksRoundTrip = it "preserves blocks in json -> hs -> json" $ do
    rawInput <- readFile "test/testdata/block.json" :: IO String
    let input = C8.pack rawInput 
    let block = Ae.eitherDecode input :: Either String [Block']
    case block of 
      Left r -> expectationFailure r
      Right block' -> let output = Ae.encode block'
                          inValue = Ae.eitherDecode input :: Either String Ae.Value
                          outValue = Ae.eitherDecode output :: Either String Ae.Value
                      in liftM2 diff inValue outValue `shouldBe` (Right $ Patch [])
   
rawtxRoundTrip :: Spec
rawtxRoundTrip  = it "preserves raw transactions in json -> hs -> json" $ do
    rawInput <- readFile "test/testdata/rawtransaction.json" :: IO String
    let input = C8.pack rawInput
    let txs = Ae.eitherDecode input :: Either String [RawTransaction']
    case txs of 
      Left r -> expectationFailure r
      Right txs' -> let output = Ae.encode txs'
                        inValue= Ae.eitherDecode input :: Either String Ae.Value
                        outValue = Ae.eitherDecode output :: Either String Ae.Value
                    in liftM2 diff inValue outValue `shouldBe` (Right $ Patch [])

blockDataRoundTrip :: Spec
blockDataRoundTrip  = it "preserves blockdata in json -> hs -> json" $ do
    rawInput <- readFile "test/testdata/blockdata.json" :: IO String
    let input = C8.pack rawInput
    let block = Ae.eitherDecode input :: Either String [BlockData']
    case block of 
      Left r -> expectationFailure r
      Right bs -> let output = Ae.encode bs
                      inValue= Ae.eitherDecode input :: Either String Ae.Value
                      outValue = Ae.eitherDecode output :: Either String Ae.Value
                  in liftM2 diff inValue outValue `shouldBe` (Right $ Patch [])

txRoundTrip :: Spec
txRoundTrip  = it "preserves transactions in json -> hs -> json" $ do
    rawInput <- readFile "test/testdata/transaction.json" :: IO String
    let input = C8.pack rawInput
    let block = Ae.eitherDecode input :: Either String [Transaction']
    case block of 
      Left r -> expectationFailure r
      Right bs -> let output = Ae.encode bs
                      inValue= Ae.eitherDecode input :: Either String Ae.Value
                      outValue = Ae.eitherDecode output :: Either String Ae.Value
                  in liftM2 diff inValue outValue `shouldBe` (Right $ Patch [])

-- blockRoundTrip :: Spec
-- blockRoundTrip  = it "preserves blocks in json -> hs -> json" $ do
--     rawInput <- readFile "test/testdata/block.json" :: IO String
--     let input = C8.pack rawInput
--     let block = Ae.eitherDecode input :: Either String [Block']
--     case block of 
--       Left r -> expectationFailure r
--       Right bs -> let output = Ae.encode bs
--                       inValue= Ae.eitherDecode input :: Either String Ae.Value
--                       outValue = Ae.eitherDecode output :: Either String Ae.Value
--                   in liftM2 diff inValue outValue `shouldBe` (Right $ Patch [])
