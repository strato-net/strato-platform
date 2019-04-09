{-# OPTIONS_GHC -fno-warn-missing-fields #-}
import qualified Control.Monad.Logger as ML
import qualified Data.Text as T
import Data.Time.Calendar
import Data.Time.Clock
import GHC.Conc.Sync
import Test.Hspec

import BlockApps.Logging (formatLogOutput)

spec :: Spec
spec =
  describe "commonLog" $ do
    it "INFO logs correctly" $ do
      let want = "[2019-04-09 19:45:04.501328767 UTC]  INFO | ThreadId 5     | getUnprocessedKafkaEvents           | Fetching sequenced blockchain events with offset Offset 10333"
          timestamp = UTCTime (fromGregorian 2019 4 9) (19 * 3600 + 45 * 60 + 4.501328767)
          loc = ML.Loc { ML.loc_filename="src/Executable/EthereumVM.hs", ML.loc_start=(253, 17) }
          logSource = T.pack "getUnprocessedKafkaEvents"
          level = ML.LevelInfo
          msg = ML.toLogStr "Fetching sequenced blockchain events with offset Offset 10333"
      -- This is pretty fragile. Unfortunately, I don't know how to make a ThreadId# as it has
      -- an unlifted representation. The alternative might be to make formatLogOutput polymorphic
      -- in the second argument.
      tid <- myThreadId
      formatLogOutput timestamp tid loc logSource level msg `shouldBe` want

    it "DEBUG logs correctly" $ do
      let want = "[2019-04-09 20:04:29.782414741 UTC]                   src/Executable/EthereumVM.hs:137 | DEBUG | ThreadId 6     | evm/loop/newBlock                   | Pending: 0"
          timestamp = UTCTime (fromGregorian 2019 4 9) (20 * 3600 + 4 * 60 + 29.782414741)
          loc = ML.Loc {ML.loc_filename="src/Executable/EthereumVM.hs", ML.loc_start=(137, 92) }
          logSource = T.pack "evm/loop/newBlock"
          level = ML.LevelDebug
          msg = ML.toLogStr "Pending: 0"
      tid <- myThreadId
      formatLogOutput timestamp tid loc logSource level msg `shouldBe` want

main :: IO ()
main = hspec spec
