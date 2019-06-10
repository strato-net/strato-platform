{-# LANGUAGE QuasiQuotes #-}

module Handler.JsonSpec (spec) where

import           TestImport

import           Blockchain.Output
import           Network.Wai.Test
import qualified Test.HUnit                 as HUnit
import           Test.QuickCheck.Arbitrary
import           Test.QuickCheck.Gen

import           Data.Aeson
import qualified Data.ByteString.Lazy.Char8 as BSL8
import           Data.CaseInsensitive       (CI)
import qualified Data.List                  as DL
import           Data.Maybe
import qualified Data.Text.Lazy             as TL

import qualified Yesod.Test                 as YT

import           Blockchain.Data.ArbitraryInstances ()
import           Blockchain.Data.BlockDB
import           Blockchain.Data.DataDefs
import           Blockchain.Data.Json
import           Blockchain.Data.TransactionDef
import           Blockchain.DB.SQLDB
import           Blockchain.SHA

import           Handler.Filters
import           Handler.TransactionInfo

contains :: BSL8.ByteString -> String -> Bool
contains a b = DL.isInfixOf b (TL.unpack $ decodeUtf8 a)

bodyContains' :: String -> YesodExample App ()
bodyContains' needle = withResponse $ \ res ->
  let haystack = simpleBody res
  in liftIO $ HUnit.assertBool ("Expected body " ++ show haystack ++ " to contain " ++ needle) $ haystack `contains` needle

testJSON  ::  (Show a) => (a -> [Block] -> (Bool, a)) -> a -> YesodExample App ()
testJSON f want = withResponse $ \res ->
  let extract (Right bs) = map bPrimeToB bs
      extract (Left err) = error err
      (success, got) = f want . extract . eitherDecode . simpleBody $ res
  in liftIO $ HUnit.assertBool
      ("Compared JSON contents: " ++ show got ++ " and " ++ show want)
      success

eitherGenesis :: Either String [Block]
eitherGenesis = map bPrimeToB <$> (eitherDecode "[{\"blockUncles\":[],\"receiptTransactions\":[],\"blockData\":{\"logBloom\":\"00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000\",\"extraData\":\"\",\"gasUsed\":0,\"gasLimit\":3141592,\"unclesHash\":\"1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347\",\"mixHash\":\"0000000000000000000000000000000000000000000000000000000000000000\",\"receiptsRoot\":\"56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421\",\"number\":0,\"difficulty\":131072,\"timestamp\":\"1970-01-01T00:00:00.000Z\",\"coinbase\":\"0\",\"parentHash\":\"0000000000000000000000000000000000000000000000000000000000000000\",\"nonce\":42,\"stateRoot\":\"9178d0f23c965d81f0834a4c72c6253ce6830f4022b1359aaebfc1ecba442d4e\",\"transactionsRoot\":\"56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421\"}, \"next\": \"/\"}]" ::  Either String [Block'])

genesisBlock :: Block
genesisBlock = case eitherGenesis of
    Left err -> error err
    Right [] -> error "no block"
    Right (b:_) -> b

checkKeyValue :: CI ByteString -> ByteString -> YT.YesodExample App ()
checkKeyValue k v = withResponse $ \ SResponse { simpleHeaders = h } ->
                         liftIO $ HUnit.assertBool ("Value should be " ++ (show v)) $
                         fromJust (lookup k h) == v

getLengthOfBlocks  :: Integer -> [a] -> (Bool, Integer)
getLengthOfBlocks n x = ((length x) == fromIntegral n, fromIntegral $ length x)

mapFirstOnData  ::  (Eq b) => (a -> b) -> b -> [a] -> (Bool, b)
mapFirstOnData f n (x:_) = (f x == n, f x)
mapFirstOnData _ _ [] = error "need a nonempty list"

getFirstBlockNum :: Integer -> [Block] ->  (Bool, Integer)
getFirstBlockNum = mapFirstOnData getBlockNum

getFirstTxNum :: Int -> [RawTransaction] -> (Bool, Int)
getFirstTxNum = mapFirstOnData getTxNum

-- We expect the randomly generated blocks to be inserted in ascending order
setNum :: Integer -> Block -> Block
setNum n b = let bd = blockBlockData b
             in b { blockBlockData = bd { blockDataNumber = n} }

insertRandomBlocks :: HasSQLDB m => Integer -> Int -> m [Key BlockDataRef]
insertRandomBlocks start size = do
        blocks <- liftIO . generate . vectorOf size $ (arbitrary :: Gen Block)
        let numberedBlocks = zipWith setNum [start..] blocks
        let difficulties = map (\b -> (blockDataParentHash . blockBlockData $ b, 10)) numberedBlocks
        putBlocks difficulties numberedBlocks False

insertRandomTransactions :: Int -> YesodExample App ()
insertRandomTransactions size = do
        txs <- liftIO . generate . vectorOf size $ (arbitrary :: Gen Transaction)
        runStdoutLoggingT . emitKafkaTransactions $ txs

equiv :: (Show a, Eq a) => a -> a -> YesodExample App ()
equiv x y = liftIO $ x `shouldBe` y

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
      it "returns empty list of chain info" $ do
        get ChainR
        statusIs 200

    describe "Account endpoints" $ do
      it "First account" $ do
        liftIO $ pendingWith "Requires a kafka instance to run these tests"
        insertRandomTransactions 10
        YT.request $ do
          setUrl AccountInfoR
          addGetParam "index" "0"
        statusIs 200
        bodyContains "contractRoot"

    describe "JSON Query string" $ do
      describe "Blocks" $ do
        it "Genesis block" $ do
          blockKeys <- putBlocks [(SHA 0, 0)] [genesisBlock] False
          length blockKeys `equiv` 1
          YT.request $ do
            setUrl BlockInfoR
            addGetParam "number" "0"
          statusIs 200
          bodyContains' "9178d0f23c965d81f0834a4c72c6253ce6830f4022b1359aaebfc1ecba442d4e"
      it "Indexing" $ do
        _ <- putBlocks [(SHA 0, 0)] [genesisBlock] False
        _ <- insertRandomBlocks 1 10
        YT.request $ do
          setUrl BlockInfoR
          addGetParam "maxnumber" "5"
          addGetParam "index" "0"
        statusIs 200
        testJSON getLengthOfBlocks 6
      it "Indexing empty" $ do
        YT.request $ do
          setUrl BlockInfoR
          addGetParam "maxnumber" "50"
          addGetParam "index" "51"
        statusIs 200
        testJSON getLengthOfBlocks 0
      it "First block through inequalities" $ do
        _ <- insertRandomBlocks 0 10
        YT.request $ do
          setUrl BlockInfoR
          addGetParam "maxnumber" "0"
          addGetParam "minnumber" "0"
        statusIs 200
        testJSON getLengthOfBlocks 1
        testJSON getFirstBlockNum 0

      it "First 10 blocks through inequalities" $ do
        blockKeys <- insertRandomBlocks 0 20
        length blockKeys `equiv` 20
        YT.request $ do
          setUrl BlockInfoR
          addGetParam "maxnumber" "10"
          addGetParam "minnumber" "0"
        statusIs 200
        let compareNumbers want bs = let got = sort . map (blockDataNumber . blockBlockData) $ bs
                                     in (got == want, got)
        testJSON compareNumbers [0..10]
        testJSON getLengthOfBlocks 11
        testJSON getFirstBlockNum 0

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
        liftIO $ pendingWith "Requires a kafka instance to run these tests"
        insertRandomTransactions 10
        YT.request $ do
          setUrl BlockInfoR
          addGetParam "minnumber" "1"
          addGetParam "maxnumber" "201"
          addGetParam "index" "0"
        statusIs 200
        n1 <- withResponse $ \ res -> do return
                                       . snd
                                       . getFirstBlockNum 0
                                       . map bPrimeToB
                                       . fromJust
                                       $ (decode (simpleBody res)  ::  Maybe [Block'])
        YT.request $ do
          setUrl BlockInfoR
          addGetParam "minnumber" "1"
          addGetParam "maxnumber" "201"
          addGetParam "index" $ tshow n1
        testJSON getLengthOfBlocks 100
        n2 <- withResponse $ \ res -> do return
                                       . snd
                                       . getFirstBlockNum 0
                                       . map bPrimeToB
                                       . fromJust
                                       $ (decode (simpleBody res)  ::  Maybe [Block'])
        liftIO $ HUnit.assertBool("N+1: ") $ n1 == n2

     it "Last of previous index is one less than next index for transactions" $ do
        liftIO $ pendingWith "Requires a kafka instance to run these tests"
        insertRandomTransactions 10
        YT.request $ do
          setUrl TransactionR
          addGetParam "minvalue" "1"
          addGetParam "maxvalue" "200000001"
          addGetParam "index" "0"
        statusIs 200
        n1 <- withResponse $ \ res -> do return
                                       . snd
                                       . getFirstTxNum 0
                                       . map rtPrimeToRt
                                       . fromJust
                                       $ (decode (simpleBody res)  ::  Maybe [RawTransaction'])
        liftIO $ print n1
        YT.request $ do
          setUrl TransactionR
          addGetParam "minvalue" "1"
          addGetParam "maxvalue" "200000001"
        n2 <- withResponse $ \ res -> do return
                                       . snd
                                       . getFirstTxNum 0
                                       . map rtPrimeToRt
                                       . fromJust
                                       $ (decode (simpleBody res)  ::  Maybe [RawTransaction'])
        liftIO $ HUnit.assertBool("N+1: ") $ n1 == n2
