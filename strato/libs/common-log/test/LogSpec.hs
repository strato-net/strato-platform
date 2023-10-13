{-# OPTIONS_GHC -fno-warn-missing-fields #-}

import BlockApps.Logging
import qualified Data.Text as T
import Data.Time.Calendar
import Data.Time.Clock
import GHC.Conc.Sync
import Test.Hspec

spec :: Spec
spec =
  describe "commonLog" $ do
    it "INFO logs correctly" $ do
      let want = "[2019-04-09 19:45:04.501328767 UTC]  INFO | ThreadId 6     | getUnprocessedKafkaEvents           | Fetching sequenced blockchain events with offset Offset 10333\n"
          timestamp = UTCTime (fromGregorian 2019 4 9) (19 * 3600 + 45 * 60 + 4.501328767)
          loc = Loc {loc_filename = "src/Executable/EthereumVM.hs", loc_start = (253, 17)}
          logSource = T.pack "getUnprocessedKafkaEvents"
          level = LevelInfo
          msg = toLogStr "Fetching sequenced blockchain events with offset Offset 10333"
      -- This is pretty fragile. Unfortunately, I don't know how to make a ThreadId# as it has
      -- an unlifted representation. The alternative might be to make formatLogOutput polymorphic
      -- in the second argument.
      tid <- myThreadId
      formatLogOutput timestamp tid loc logSource level msg `shouldBe` want

    it "DEBUG logs correctly" $ do
      let want = "[2019-04-09 20:04:29.782414741 UTC]                   src/Executable/EthereumVM.hs:137 | DEBUG | ThreadId 7     | evm/loop/newBlock                   | Pending: 0\n"
          timestamp = UTCTime (fromGregorian 2019 4 9) (20 * 3600 + 4 * 60 + 29.782414741)
          loc = Loc {loc_filename = "src/Executable/EthereumVM.hs", loc_start = (137, 92)}
          logSource = T.pack "evm/loop/newBlock"
          level = LevelDebug
          msg = toLogStr "Pending: 0"
      tid <- myThreadId
      formatLogOutput timestamp tid loc logSource level msg `shouldBe` want

main :: IO ()
main = hspec spec
