{-# LANGUAGE OverloadedStrings #-}

import Blockchain.Slipstream.OutputData
import Blockchain.Slipstream.QueryFormatHelper
import Blockchain.Slipstream.MessageConsumer (sinkSlipstreamOutputChunks, slipstreamOutputChunkSize)
import Blockchain.Slipstream.SQL
import Conduit
import Data.IORef
import qualified Data.Text as T
import Test.Hspec

main :: IO ()
main = hspec $ do
  describe "output chunking" $ do
    it "bounds buffered outputs without losing query order" $ do
      let queries = RawSQL . T.pack . show <$> [(1 :: Int) .. 600]
      observedRef <- newIORef []
      runConduit $
        yieldMany (Right <$> queries) .|
          sinkSlipstreamOutputChunks slipstreamOutputChunkSize
            (\slipstreamQueries _ -> modifyIORef' observedRef (slipstreamQueries :))
      observed <- reverse <$> readIORef observedRef
      concat observed `shouldBe` queries
      map length observed `shouldBe` [256, 256, 88]

  describe "prepareSlipstreamQueries" $ do
    it "bounds multi-row inserts without losing or reordering rows" $ do
      let row = [Nothing]
          query = InsertTable (IndexTableName "" "bounded") [("value", SqlText)] (replicate 600 row) (Just DoNothing)
          prepared = prepareSlipstreamQueries [query]
      length prepared `shouldBe` 3
      sum (map insertRowCount prepared) `shouldBe` 600
      map insertRowCount prepared `shouldSatisfy` all (<= slipstreamInsertRowLimit)

  describe "slipstreamQueryChunks" $ do
    it "preserves order while enforcing the query-count bound" $ do
      let queries = RawSQL . T.pack . show <$> [(1 :: Int) .. 600]
          chunks = slipstreamQueryChunks queries
      concat chunks `shouldBe` queries
      map length chunks `shouldSatisfy` all (<= slipstreamQueryChunkSize)

    it "bounds combined SQL text by bytes when individual statements fit" $ do
      let query = RawSQL $ T.replicate 700000 "x"
          chunks = slipstreamQueryChunks [query, query, query]
      map length chunks `shouldBe` [2, 1]

  describe "isRecoverableSqlState" $ do
    it "retries statement errors but propagates connection, rollback, and cancellation errors" $ do
      isRecoverableSqlState "42703" `shouldBe` True
      isRecoverableSqlState "23505" `shouldBe` True
      isRecoverableSqlState "08006" `shouldBe` False
      isRecoverableSqlState "40001" `shouldBe` False
      isRecoverableSqlState "57014" `shouldBe` False

  describe "history triggers" $ do
    it "retains baseline behavior for same-block updates" $ do
      case initialSlipstreamQueries of
        storageHistoryQuery : _ ->
          T.isInfixOf "OLD.block_hash = NEW.block_hash" (slipstreamQueryPostgres storageHistoryQuery)
            `shouldBe` False
        [] -> expectationFailure "initialSlipstreamQueries is empty"

insertRowCount :: SlipstreamQuery -> Int
insertRowCount InsertTable {values = rows} = length rows
insertRowCount _ = 0
