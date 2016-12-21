{-# LANGUAGE QuasiQuotes #-}

module Handler.JsonSpec (spec) where

import TestImport

import qualified Test.HUnit as HUnit
import Network.Wai.Test

import qualified Data.ByteString.Lazy.Char8 as BSL8
import qualified Data.Text.Lazy as TL
import qualified Data.List as DL
import Data.Aeson
import Data.Maybe

import System.Exit (exitFailure)
import System.IO (withFile, IOMode(..))

import Yesod.Test

import Handler.Common 
import Blockchain.Data.DataDefs
import Blockchain.Data.Json

import Handler.BlockInfo
import Blockchain.Data.Address
import Handler.Filters

import System.TimeIt

import Debug.Trace
mydebug = flip trace

contains :: BSL8.ByteString -> String -> Bool
contains a b = DL.isInfixOf b (TL.unpack $ decodeUtf8 a)

bodyContains' :: String -> YesodExample site ()
bodyContains' text = withResponse $ \ res ->
  liftIO $ HUnit.assertBool ("Expected body to contain " ++ text) $
    (simpleBody res) `contains` text

-- testJSON :: (Show a, Eq a) => ([Block] -> a -> (Bool, a)) -> a -> YesodExample site ()
-- testJSON f n = withResponse $ \ res ->
--   liftIO $ HUnit.assertBool ("Compared JSON contents: " ++ show (snd (f (fromJust $ (decode (simpleBody res) :: Maybe [Block])) n)) ++ " and " ++ show n) $
--     fst $ (f (fromJust $ (decode (simpleBody res) :: Maybe [Block])) n)

--genesis = (decode "[{\"blockUncles\":[],\"receiptTransactions\":[],\"blockData\":{\"logBloom\":\"00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000\",\"extraData\":0,\"gasUsed\":0,\"gasLimit\":3141592,\"unclesHash\":\"1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347\",\"mixHash\":\"0000000000000000000000000000000000000000000000000000000000000000\",\"receiptsRoot\":\"56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421\",\"number\":0,\"difficulty\":131072,\"timestamp\":\"1970-01-01T00:00:00.000Z\",\"coinbase\":{\"address\":\"0\"},\"parentHash\":\"0000000000000000000000000000000000000000000000000000000000000000\",\"nonce\":42,\"stateRoot\":\"9178d0f23c965d81f0834a4c72c6253ce6830f4022b1359aaebfc1ecba442d4e\",\"transactionsRoot\":\"56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421\"}}]" ):: Maybe [Block]

checkKeyValue k v = withResponse $ \ SResponse { simpleHeaders = h } ->
                         liftIO $ HUnit.assertBool ("Value should be " ++ (show v)) $
                         fromJust (lookup k h) == v


getSR:: Block -> String
getSR (Block (BlockData ph uh cb@(Address a) sr tr rr lb d num gl gu ts ed non mh) rt bu) = show sr 

getLengthOfBlocks :: [a] -> Integer -> (Bool, Integer)
getLengthOfBlocks x n = ((length x) == fromIntegral n, fromIntegral $ length x)

mapOnData :: (Eq b) => (a -> b) -> [a] -> b -> (Bool, b)
mapOnData f (x:xs) n = (f x == n, f x)

mapFirstOnData :: (Eq b) => (a -> b) -> [a] -> b -> (Bool, b)
mapFirstOnData f (x:xs) n = (f x == n, f x)

getFirstBlockSR = mapFirstOnData getSR
getFirstBlockNum = mapFirstOnData getBlockNum
getFirstTxNum = mapFirstOnData getTxNum
getLastBlockNum x n = getFirstBlockNum (reverse x) n




spec :: Spec
spec = withApp $
    describe "JSON fixed endpoints" $ do
    -- describe "Account endpoints" $ do
    --  it "First account" $ do
    --     get $ AccAddressR "1c11aa45c792e202e9ffdc2f12f99d0d209bef70"
    --     statusIs 200
    --     bodyContains' "contractRoot"
    describe "JSON Query string" $ do
    describe "Blocks" $ do
     it "Genesis block" $ do
        get $ ("/query/block?number=0&raw=1" :: Text)
        statusIs 200 
        bodyContains' "9178d0f23c965d81f0834a4c72c6253ce6830f4022b1359aaebfc1ecba442d4e"
        --testJSON  getFirstBlockSR "9178d0f23c965d81f0834a4c72c6253ce6830f4022b1359aaebfc1ecba442d4e"
--         testJSON getFirstBlockNum 0
-- 
--      it "Indexing" $ do
--         get ("/query/block?maxnumber=100&index=51&raw=1" :: Text)
--         statusIs 200
--         testJSON getLengthOfBlocks 50
--      it "Indexing empty" $ do
--         get ("/query/block?maxnumber=50&index=51&raw=1" :: Text)
--         statusIs 200
--         testJSON getLengthOfBlocks 0
-- 
--      it "First block through inequalities" $ do
--         get ("/query/block?maxnumber=0&minnumber=0&raw=1" :: Text)
--         statusIs 200
--         testJSON getLengthOfBlocks 1
--         testJSON getFirstBlockNum 0
-- 
--      it "First 100 blocks through inequalities" $ do
--         get ("/query/block?maxnumber=100&minnumber=0&raw=1" :: Text)
--         statusIs 200
--         testJSON getLengthOfBlocks 100
--         testJSON getFirstBlockNum 0

     it "Access pattern" $ do
        get ("/query/block?minnumber=0&maxnumber=50&index=0&raw=1" :: Text)
        checkKeyValue "Access-Control-Allow-Origin" "*"

     it "Content type" $ do
        get ("/query/block?minnumber=0&maxnumber=50&index=0&raw=1" :: Text)
        checkKeyValue "Content-Type" "application/json; charset=utf-8"
    describe "Transaction endpoints" $ do
     it "Transaction from block" $ do
        get ("/query/transaction?blockid=0&raw=1" :: Text)
        statusIs 200
    describe "Complicated endpoints" $ do
     -- it "Last of previous index is one less than next index for blocks" $ do
     --    get $ "/query/block?minnumber=1&maxnumber=201&raw=1" ++ "&index=" ++ (show 0)
     --    statusIs 200
     --    n1 <- withResponse $ \ res -> do 
     --      return $ snd $ (getFirstBlockNum (fromJust $ (decode (simpleBody res) :: Maybe [Block])) 0)
     --    get $ "/query/block?minnumber=1&maxnumber=201&raw=1" ++ "&index=" ++ (show  n1)
     --    testJSON getLengthOfBlocks 100
     --    n2 <- withResponse $ \ res -> do 
     --      return $ snd $ (getFirstBlockNum (fromJust $ (decode (simpleBody res) :: Maybe [Block])) 0)
     --    liftIO $ HUnit.assertBool("N+1: ") $ n1 == n2

     it "Last of previous index is one less than next index for transactions" $ do
        get $ "/query/transaction?minvalue=1&maxvalue=200000001&raw=1" ++ "&index=" ++ (show 0)
        statusIs 200
        n1 <- withResponse $ \ res -> do 
          return $ snd $ (getFirstTxNum (fromJust $ (decode (simpleBody res) :: Maybe [RawTransaction])) 0)
        liftIO $ traceIO $ show n1
        get $ "/query/transaction?minvalue=1&maxvalue=200000001&raw=1" ++ "&index=" ++ (show  n1)
        --testJSON getLengthOfBlocks 100
        n2 <- withResponse $ \ res -> do 
          return $ snd $ (getFirstTxNum (fromJust $ (decode (simpleBody res) :: Maybe [RawTransaction])) 0)
        liftIO $ HUnit.assertBool("N+1: ") $ n1 == n2
