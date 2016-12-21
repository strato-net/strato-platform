
import Control.Monad.IO.Class
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import Data.Maybe
import Network.Kafka.Protocol

import Blockchain.Stream.Raw
import Blockchain.KafkaTopics

main::IO ()
main = backupBlocks 0

backupBlocks::Offset->IO ()
backupBlocks startingBlock = do
  doConsume' startingBlock
  where
    doConsume' offset = do
      result <- fmap (fromMaybe (error "offset out of range")) $ fetchBytesIO (lookupTopic "block") offset

      liftIO $ putStr $ unlines $ map (BC.unpack . B16.encode) result

      doConsume' (offset + fromIntegral (length result))
