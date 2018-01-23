{-# LANGUAGE QuasiQuotes #-}

module Handler.JsonSpec (spec) where

import           TestImport

import           Network.Wai.Test
import qualified Test.HUnit                 as HUnit

import           Data.Aeson
import qualified Data.ByteString.Lazy.Char8 as BSL8
import qualified Data.List                  as DL
import           Data.Maybe
import qualified Data.Text.Lazy             as TL

import           System.Exit                (exitFailure)
import           System.IO                  (IOMode (..), withFile)

import           Yesod.Test
import qualified Yesod.Test                 as YT

import           Blockchain.Data.BlockDB
import           Blockchain.Data.DataDefs
import           Blockchain.Data.Json
import           Blockchain.SHA
import           Handler.Common

import           Blockchain.Data.Address
import           Handler.BlockInfo
import           Handler.Filters

import           System.TimeIt

import           Debug.Trace
mydebug = flip trace

contains  ::  BSL8.ByteString -> String -> Bool
contains a b = DL.isInfixOf b (TL.unpack $ decodeUtf8 a)

bodyContains'  ::  String -> YesodExample site ()
bodyContains' text = withResponse $ \ res ->
  liftIO $ HUnit.assertBool ("Expected body to contain " ++ text) $
    (simpleBody res) `contains` text

-- TODO(tim): declare FromJSON Block to fix the json tests
-- testJSON  ::  (Show a, Eq a) => ([Block] -> a -> (Bool, a)) -> a -> YesodExample site ()
-- testJSON f want = withResponse $ \res ->
--   let bs = fromJust (decode (simpleBody res) :: Maybe [Block])
--       (success, got) = f bs want
--   in liftIO $ HUnit.assertBool
--       ("Compared JSON contents: " ++ show got ++ " and " ++ show want)
--       success

bPrimeToB :: Block' -> Block
bPrimeToB (Block' b _) = b

genesisBlock :: [Block]
genesisBlock = map bPrimeToB (fromMaybe [] ((decode "[{\"blockUncles\":[],\"receiptTransactions\":[],\"blockData\":{\"logBloom\":\"00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000\",\"extraData\":0,\"gasUsed\":0,\"gasLimit\":3141592,\"unclesHash\":\"1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347\",\"mixHash\":\"0000000000000000000000000000000000000000000000000000000000000000\",\"receiptsRoot\":\"56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421\",\"number\":0,\"difficulty\":131072,\"timestamp\":\"1970-01-01T00:00:00.000Z\",\"coinbase\":{\"address\":\"0\"},\"parentHash\":\"0000000000000000000000000000000000000000000000000000000000000000\",\"nonce\":42,\"stateRoot\":\"9178d0f23c965d81f0834a4c72c6253ce6830f4022b1359aaebfc1ecba442d4e\",\"transactionsRoot\":\"56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421\"}}]" ) ::  Maybe [Block']) :: [Block'])

checkKeyValue k v = withResponse $ \ SResponse { simpleHeaders = h } ->
                         liftIO $ HUnit.assertBool ("Value should be " ++ (show v)) $
                         fromJust (lookup k h) == v


getSR ::  Block -> String
getSR (Block (BlockData ph uh cb@(Address a) sr tr rr lb d num gl gu ts ed non mh) rt bu) = show sr

getLengthOfBlocks  ::  [a] -> Integer -> (Bool, Integer)
getLengthOfBlocks x n = ((length x) == fromIntegral n, fromIntegral $ length x)

mapOnData  ::  (Eq b) => (a -> b) -> [a] -> b -> (Bool, b)
mapOnData f (x:xs) n = (f x == n, f x)

mapFirstOnData  ::  (Eq b) => (a -> b) -> [a] -> b -> (Bool, b)
mapFirstOnData f (x:xs) n = (f x == n, f x)

getFirstBlockSR = mapFirstOnData getSR
getFirstBlockNum = mapFirstOnData getBlockNum
getFirstTxNum = mapFirstOnData getTxNum
getLastBlockNum x n = getFirstBlockNum (reverse x) n


spec  ::  Spec
spec = withApp $ do
    describe "JSON fixed endpoints" $ do
      it "returns logs" $ do
        get LogInfoR
        statusIs 200
      it "requires a parameter for /block" $ do
        get BlockInfoR
        statusIs 400
      it "returns blocks" $ do
        YT.request $ do
          setUrl BlockInfoR
          addGetParam "index" "0"
        statusIs 200
        YT.request $ do
          setUrl BlockInfoR
          addGetParam "number" "3"
        statusIs 200
      it "returns last block" $ do
        get $ BlkLastR 10
        statusIs 200

    describe "Account endpoints" $ do
      it "First account" $ do
        YT.request $ do
          setUrl AccountInfoR
          addGetParam "address" "1c11aa45c792e202e9ffdc2f12f99d0d209bef70"
        statusIs 200
        bodyEquals "[]" -- No accounts defined
        -- bodyContains "contractRoot"

    describe "JSON Query string" $ do
      describe "Blocks" $ do
        it "Genesis block" $ do
          putBlocks [(SHA 0, 0)] genesisBlock False
          YT.request $ do
            setUrl BlockInfoR
            addGetParam "number" "0"
          statusIs 200
          -- TODO(tim): Insert the genesis block above
          -- bodyContains' "9178d0f23c965d81f0834a4c72c6253ce6830f4022b1359aaebfc1ecba442d4e"
      it "Indexing" $ do
        YT.request $ do
          setUrl BlockInfoR
          addGetParam "maxnumber" "100"
          addGetParam "index" "51"
        statusIs 200
        -- testJSON getLengthOfBlocks 50
      it "Indexing empty" $ do
        YT.request $ do
          setUrl BlockInfoR
          addGetParam "maxnumber" "50"
          addGetParam "index" "51"
        statusIs 200
        -- testJSON getLengthOfBlocks 0
      it "First block through inequalities" $ do
        YT.request $ do
          setUrl BlockInfoR
          addGetParam "maxnumber" "0"
          addGetParam "minnumber" "0"
        statusIs 200
        -- testJSON getLengthOfBlocks 1
        -- testJSON getFirstBlockNum 0

      it "First 100 blocks through inequalities" $ do
        YT.request $ do
          setUrl BlockInfoR
          addGetParam "maxnumber" "100"
          addGetParam "minnumber" "0"
        statusIs 200
        -- testJSON getLengthOfBlocks 100
        -- testJSON getFirstBlockNum 0

      it "Access pattern" $ do
        YT.request $ do
          setUrl BlockInfoR
          addGetParam "minnumber" "0"
          addGetParam "maxnumber" "50"
          addGetParam "index" "0"
        checkKeyValue "Access-Control-Allow-Origin" "*"

      it "Content type" $ do
        YT.request $ do
          setUrl BlockInfoR
          addGetParam "minnumber" "0"
          addGetParam "maxnumber" "50"
          addGetParam "index" "0"
        checkKeyValue "Content-Type" "application/json; charset=utf-8"
    describe "Transaction endpoints" $ do
      it "Transaction from block" $ do
        YT.request $ do
          setUrl TransactionR
          addGetParam "blocknumber" "0"
        statusIs 200
    describe "Complicated endpoints" $ do
     it "Last of previous index is one less than next index for blocks" $ do
        YT.request $ do
          setUrl BlockInfoR
          addGetParam "minnumber" "1"
          addGetParam "maxnumber" "201"
          addGetParam "index" "0"
        statusIs 200
        -- n1 <- withResponse $ \ res -> do
        --   return $ snd $ (getFirstBlockNum (fromJust $ (decode (simpleBody res)  ::  Maybe [Block])) 0)
        -- YT.request $ do
        --   setUrl BlockInfoR
        --   addGetParam "minnumber" "1"
        --   addGetParam "maxnumber" "201"
        --   addGetParam "index" $ show n1
        -- testJSON getLengthOfBlocks 100
        -- n2 <- withResponse $ \ res -> do
        --   return $ snd $ (getFirstBlockNum (fromJust $ (decode (simpleBody res)  ::  Maybe [Block])) 0)
        -- liftIO $ HUnit.assertBool("N+1: ") $ n1 == n2

     it "Last of previous index is one less than next index for transactions" $ do
        YT.request $ do
          setUrl TransactionR
          addGetParam "minvalue" "1"
          addGetParam "maxvalue" "200000001"
          addGetParam "index" "0"
        statusIs 200
        -- TODO(tim) Insert transactions into the database so getFirstTxNum can succeed
        -- n1 <- withResponse $ \ res -> do
        --   return $ snd $ (getFirstTxNum (fromJust $ (decode (simpleBody res)  ::  Maybe [RawTransaction])) 0)
        -- liftIO $ traceIO $ show n1
        -- YT.request $ do
        --   setUrl TransactionR
        --   addGetParam "minvalue" "1"
        --   addGetParam "maxvalue" "200000001"
        -- n2 <- withResponse $ \ res -> do
        --   return $ snd $ (getFirstTxNum (fromJust $ (decode (simpleBody res)  ::  Maybe [RawTransaction])) 0)
        -- liftIO $ HUnit.assertBool("N+1: ") $ n1 == n2
