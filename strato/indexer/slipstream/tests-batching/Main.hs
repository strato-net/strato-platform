{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}

import BlockApps.Logging (runNoLoggingT)
import qualified Blockchain.Slipstream.Events as E
import qualified BlockApps.SolidVMStorageDecoder as Decoder
import Blockchain.Slipstream.Data.Action (AggregateAction(..))
import Blockchain.Slipstream.Processor (processedContractToProcessedCollectionRows)
import qualified Blockchain.Stream.Action as Action
import SolidVM.Model.Storable
import SolidVM.Model.CodeCollection (emptyCodeCollection)
import qualified SolidVM.Model.Type as SVMType
import Data.Default (def)
import Data.List (nub)
import Blockchain.Slipstream.OutputData
import Blockchain.Slipstream.QueryFormatHelper
import Blockchain.Slipstream.MessageConsumer (sinkSlipstreamOutputChunks, slipstreamOutputChunkSize)
import Blockchain.Slipstream.SQL
import Blockchain.Slipstream.SolidityValue
import Blockchain.Strato.Model.Keccak256 (unsafeCreateKeccak256FromWord256, zeroHash)
import qualified BlockApps.Solidity.Value as V
import Conduit
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString as B
import Data.IORef
import qualified Data.Map.Strict as Map
import qualified Data.Text as T
import Data.Time (UTCTime (..), fromGregorian)
import Test.Hspec

main :: IO ()
main = hspec $ do
  describe "binary collection keys" $ do
    let keyPath key = StoragePath [Field "counts", Index key]
        keys = [either error id $ B16.decode "c009e7c12890c67a2e36deb34ca9540060e3e542f456c818a91761be623b7fce", B.pack [0xc0, 0, 0xff], B.pack [0xc0, 0, 0xfe], B.replicate 32 0, B.replicate 32 65, "caf\xc3\xa9", "~hex:c000ff"]
        storage = Map.fromList [(keyPath key, BInteger 3) | key <- keys]
        rows = processedContractToProcessedCollectionRows $ AggregateAction
          zeroHash (UTCTime (fromGregorian 2026 9 29) 0) 1 0x1 0x2 (Action.SolidVMDiff storage)
    it "preserves distinct raw keys through decoding and collection processing" $ do
      length (Decoder.decodeCacheValuesForCollections storage) `shouldBe` length keys
      length rows `shouldBe` length keys
      length (nub $ collectionDataPath <$> rows) `shouldBe` length keys
      mapM_ (\row -> T.any (== '\0') (collectionDataPath row) `shouldBe` False) rows
      mapM_ (\key -> (\row -> collectionDataKeys row == [V.SimpleValue $ V.ValueBytes Nothing key]) `any` rows `shouldBe` True) keys
      Decoder.decodeSolidVMValues (Map.toList storage) `shouldSatisfy` either (const False) (const True)
    it "emits lossless hex alongside readable keys without NUL in SQL" $ do
      queries <- runNoLoggingT $ runConduit $ insertCollectionTable rows .| sinkList
      let sql = T.concat $ slipstreamQueryPostgres <$> queries
      T.isInfixOf "key_hex" sql `shouldBe` True
      T.isInfixOf "c000ff" sql `shouldBe` True
      T.isInfixOf "c000fe" sql `shouldBe` True
      T.isInfixOf (T.replicate 32 "41") sql `shouldBe` True
      T.any (== '\0') sql `shouldBe` False
      T.isInfixOf "Cannot decode byte" sql `shouldBe` False
    it "hex-encodes NUL-containing bytes values such as bytes32(0)" $ do
      let zeroRows = processedContractToProcessedCollectionRows $ AggregateAction
            zeroHash (UTCTime (fromGregorian 2026 10 1) 0) 1 0x1 0x2
            (Action.SolidVMDiff $ Map.fromList [(keyPath "41", BBytes $ B.replicate 32 0)])
      queries <- runNoLoggingT $ runConduit $ insertCollectionTable zeroRows .| sinkList
      let sql = T.concat $ slipstreamQueryPostgres <$> queries
      T.any (== '\0') sql `shouldBe` False
      T.isInfixOf (T.replicate 64 "0") sql `shouldBe` True
    it "uses declared bytes types for nested view keys, preserving numeric and address keys" $ do
      queries <- runNoLoggingT $ runConduit $
        (createCollectionTable ("Test", "Keys") def emptyCodeCollection
          ("counts", [SVMType.Bytes Nothing (Just 32), SVMType.Int Nothing Nothing, SVMType.Address False, SVMType.Bytes Nothing Nothing], SVMType.Int Nothing Nothing) >> pure ()) .| sinkList
      case queries of
        [query@CreateView{}] -> do
          viewColumns query `shouldBe` [([("key", SqlBytesKey), ("key2", SqlDecimal), ("key3", SqlText), ("key4", SqlBytesKey)], "key")]
          -- column expressions travel to slipstream_upsert_view as quoted literals
          let sql = T.replace "''" "'" $ slipstreamQueryPostgres query
          T.isInfixOf "THEN s.\"key\"->>'key_hex'" sql `shouldBe` True
          T.isInfixOf "THEN s.\"key\"->>'key4_hex'" sql `shouldBe` True
          T.isInfixOf "->>'key2')::numeric" sql `shouldBe` True
        _ -> expectationFailure "Expected one collection view"

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

  describe "valueToSolidityValue" $ do
    it "preserves valid UTF-8 byte values" $
      valueToSolidityValue (V.SimpleValue (V.valueBytes "hello"))
        `shouldBe` Just (SolidityValueAsString "hello")

    it "hex-encodes invalid UTF-8 byte values instead of crashing" $
      valueToSolidityValue (V.SimpleValue (V.valueBytes (B.pack [0x9f])))
        `shouldBe` Just (SolidityValueAsString "9f")

  describe "question mark escaping" $ do
    it "escapes question marks embedded in struct JSON for Persistent" $
      valueToSQLText'
        True
        ( V.ValueStruct $
            Map.singleton
              "description"
              (V.SimpleValue $ V.ValueString "https://example.com/a?b=c")
        )
        `shouldBe` Just "{\"description\":\"https://example.com/a??b=c\"}"

    it "escapes question marks embedded in array JSON for Persistent" $
      valueToSQLText'
        True
        (V.ValueVariadic [V.SimpleValue $ V.ValueString "is this safe?"])
        `shouldBe` Just "[\"is this safe??\"]"

  describe "history triggers" $ do
    it "retains baseline behavior for same-block updates" $ do
      case initialSlipstreamQueries of
        storageHistoryQuery : _ ->
          T.isInfixOf "OLD.block_hash = NEW.block_hash" (slipstreamQueryPostgres storageHistoryQuery)
            `shouldBe` False
        [] -> expectationFailure "initialSlipstreamQueries is empty"

    it "lets only a newer block overwrite storage and mapping rows" $ do
      let ts = UTCTime (fromGregorian 2026 10 1) 0
          bh = unsafeCreateKeccak256FromWord256 1
          contract = E.ProcessedContract 0xabc bh ts 7 Map.empty
          row = ProcessedCollectionRow 0xabc Nothing "_balances" "Mapping" bh bh ts 7
            [V.SimpleValue $ V.ValueString "u"] "_balances[u]" (V.SimpleValue $ V.ValueString "5")
      queries <- runNoLoggingT . runConduit $
        (insertIndexTable contract >> insertCollectionTable [row]) .| sinkList
      map slipstreamQueryPostgres queries `shouldSatisfy` \case
        [storageUpsert, mappingUpsert] ->
          " WHERE excluded.block_number::bigint > \"storage\".block_number::bigint;" `T.isSuffixOf` storageUpsert
            && " WHERE excluded.block_number::bigint > \"mapping\".block_number::bigint;" `T.isSuffixOf` mappingUpsert
        _ -> False

    it "creates the history tables without a primary key" $
      [pk | CreateTable {tableName = HistoryTableName {}, primaryKeyColumns = pk} <- initialSlipstreamQueries]
        `shouldBe` [[], []]

insertRowCount :: SlipstreamQuery -> Int
insertRowCount InsertTable {values = rows} = length rows
insertRowCount _ = 0
