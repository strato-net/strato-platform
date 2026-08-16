-- | Incremental BlockBodies → unseq encode/produce.
-- A full [IEBlock] batch (retainers.log TOUNSEQ n=500) must not be held
-- across produceMessagesAsSingletonSets; each step sees one block.
module Blockchain.Sequencer.UnseqProduce
  ( unseqProduceChunkSize,
    forUnseqBlocks,
    encodeUnseqEvent,
  )
where

import Blockchain.Data.Block (Block (..))
import qualified Blockchain.Data.TXOrigin as TO
import Blockchain.Model.WrappedBlock (blockToIngestBlock)
import Blockchain.Sequencer.Event (IngestEvent (..))
import Data.Binary (encode)
import qualified Data.ByteString as BS
import qualified Data.ByteString.Lazy as BL

-- | Max IEBlocks retained for one encode/produce step.
unseqProduceChunkSize :: Int
unseqProduceChunkSize = 1

-- | Same per-event encoding produceItems uses (Binary then toStrict).
encodeUnseqEvent :: IngestEvent -> BS.ByteString
encodeUnseqEvent = BL.toStrict . encode

-- | Walk a BlockBodies [Block] without allocating the full [IEBlock]
-- first. Each callback is one encode/produce step and sees at most
-- 'unseqProduceChunkSize' events. Consumed blocks can be GC'd before
-- the next step.
forUnseqBlocks ::
  Monad m =>
  TO.TXOrigin ->
  [Block] ->
  ([IngestEvent] -> m a) ->
  m [a]
forUnseqBlocks origin blocks k = go blocks
  where
    go [] = return []
    go bs = do
      let (chunk, rest) = splitAt unseqProduceChunkSize bs
          evs = map (IEBlock . blockToIngestBlock origin) chunk
      a <- k evs
      (a :) <$> go rest
