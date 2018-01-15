{-# LANGUAGE OverloadedStrings #-}
import           Control.Monad
import           Data.Aeson
import           Data.Aeson                      as Ae
import           Data.Aeson.Diff
import qualified Data.ByteString                 as B
import qualified Data.ByteString.Lazy.Char8      as C8
import qualified Data.ByteString.Base16          as B16
import qualified Data.HashMap.Strict                    as HM
import qualified Data.Text                       as T
import qualified Data.Text.Encoding              as T
import qualified Data.Vector                     as V
import           Test.Hspec

import           Blockchain.Data.Address
import           Blockchain.Strato.Model.ExtendedWord
import           Blockchain.Strato.Model.Code
import           Blockchain.Strato.Model.SHA
import           Blockchain.Data.Json 
import  Blockchain.Data.Transaction

import Debug.Trace

tk :: (Show a) => String -> a -> a
tk x a = trace (x ++ show a) a
-- tk x = id

main :: IO()
main = hspec $ do
  describe "Data round trips" $ do
    -- addressTesting 
    -- rawtxRoundTrip
    -- blockDataRoundTrip
    -- txRoundTrip
    matchingHash
    -- blockRoundTrip
    -- codeRoundTrip

addressTesting :: Spec
addressTesting = forM_ testAddresses $ \input -> do
      it ("fromJSON . toJSON = id on address " ++ input) $ do
        let output = T.unpack . addressToString . stringToAddress $ input
        output `shouldBe` input

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

blockRoundTrip :: Spec
blockRoundTrip = it "preserves blocks in json -> hs -> json" $ do
    rawInput <- readFile "test/testdata/block.json" :: IO String
    let input = C8.pack rawInput 
    let block = Ae.eitherDecode input :: Either String [Block']
    compareJSON input block
   
rawtxRoundTrip :: Spec
rawtxRoundTrip  = it "preserves raw transactions in json -> hs -> json" $ do
    rawInput <- readFile "test/testdata/rawtransaction.json" :: IO String
    let input = C8.pack rawInput
    let txs = Ae.eitherDecode input :: Either String [RawTransaction']
    compareJSON input txs

blockDataRoundTrip :: Spec
blockDataRoundTrip  = it "preserves blockdata in json -> hs -> json" $ do
    rawInput <- readFile "test/testdata/blockdata.json" :: IO String
    let input = C8.pack rawInput
    let block = Ae.eitherDecode input :: Either String [BlockData']
    compareJSON input block

txRoundTrip :: Spec
txRoundTrip  = it "preserves transactions in json -> hs -> json" $ do
    rawInput <- readFile "test/testdata/transaction.json" :: IO String
    let input = C8.pack rawInput
    let tx = Ae.eitherDecode input :: Either String [Transaction']
    compareJSON input tx

codeRoundTrip :: Spec 
codeRoundTrip = it "preservers code in json -> hs -> json" $ do
    let input = C8.pack "\"de5f72fd\""
    let code = Ae.eitherDecode input :: Either String Code
    compareJSON input code

-- compare checks that the parsed value (`actual`) is structurally equivalent
-- to the bytestring by diffing the corresponding Aeson.Values
compareJSON :: (Show a, FromJSON a, ToJSON a) => C8.ByteString -> Either String a -> Expectation
compareJSON expected actual = 
  case (tk "actual" actual) of
      Left r -> expectationFailure r
      Right c -> let output = tk "output" $ Ae.encode c
                     inValue = tk "inValue" $ Ae.eitherDecode (tk "expected" expected) :: Either String Ae.Value
                     outValue = tk "outValue" $ Ae.eitherDecode output :: Either String Ae.Value
                 in liftM2 diff inValue outValue`shouldBe` (Right $ Patch [])

matchingHash :: Spec
matchingHash = it "doesnt mutate the hash" $ do
  rawInput <- readFile "test/testdata/transaction.json" :: IO String
  let input = C8.pack rawInput
  let tx = case Ae.eitherDecode input :: Either String [Transaction'] of
               Right txs -> tPrimeToT $ head txs
               Left err -> undefined
  let json = Ae.eitherDecode input :: Either String Ae.Value
  let obj = case json of 
             Right (Array os) -> V.head os
             _ -> undefined
  let h = case obj of
             Object o -> HM.lookup "hash" o
             _ -> undefined

  let jsonHash = case h of 
                   Just (String hs) -> hs
                   _ -> undefined
  jsonHash `shouldBe` ((tk "packed") . T.pack . (tk "toHex") . shaToHex . (tk "tHash") . transactionHash . (tk "tx") $ tx)
