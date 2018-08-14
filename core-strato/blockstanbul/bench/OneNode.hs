{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
import Control.Monad.IO.Class
import Control.Monad.Logger
import Control.Monad.Trans.State.Lazy

import Data.Aeson
import Data.Maybe
import qualified Network.Haskoin.Crypto as HK

import Blockchain.Blockstanbul
import Blockchain.Blockstanbul.Authentication
import Blockchain.Data.Block
import Blockchain.Data.Json
import Blockchain.Strato.Model.Address

import Criterion.Main

eitherGenesis :: Either String [Block]
eitherGenesis = map bPrimeToB <$> (eitherDecode "[{\"blockUncles\":[],\"receiptTransactions\":[],\"blockData\":{\"logBloom\":\"00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000\",\"extraData\":\"\",\"gasUsed\":0,\"gasLimit\":3141592,\"unclesHash\":\"1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347\",\"mixHash\":\"0000000000000000000000000000000000000000000000000000000000000000\",\"receiptsRoot\":\"56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421\",\"number\":0,\"difficulty\":131072,\"timestamp\":\"1970-01-01T00:00:00.000Z\",\"coinbase\":\"0\",\"parentHash\":\"0000000000000000000000000000000000000000000000000000000000000000\",\"nonce\":42,\"stateRoot\":\"9178d0f23c965d81f0834a4c72c6253ce6830f4022b1359aaebfc1ecba442d4e\",\"transactionsRoot\":\"56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421\"}, \"next\": \"/\"}]" ::  Either String [Block'])

genesisBlock :: Block
genesisBlock = case eitherGenesis of
  Left err -> error err
  Right [] -> error "no block"
  Right (b:_) -> b

benchContext :: BlockstanbulContext
benchContext =
  let mKey = HK.makePrvKey 0x3f06311cf94c7eafd54e0ffc8d914cf05a051188000fee52a29f3ec834e5abc5
      pk = fromMaybe (error "working key now fails") mKey
  in  newContext (View 200 40) [prvKey2Address pk] pk

-- Note: it may be worthwhile to add more layers so that it resembles
-- the sequencer
runBench :: StateT BlockstanbulContext (NoLoggingT IO) a -> IO a
runBench = runNoLoggingT . flip evalStateT benchContext

instance HasBlockstanbulContext (StateT BlockstanbulContext (NoLoggingT IO)) where
  getBlockstanbulContext = gets Just
  putBlockstanbulContext = put

fullRound :: (HasBlockstanbulContext m, MonadIO m, MonadLogger m)=> Block -> m [OutEvent]
fullRound b' = do
  let b = truncateExtra b'
  sendAllMessages [NewBlock b]

genesisBench :: IO [OutEvent]
genesisBench = runBench . fullRound $ genesisBlock

main :: IO ()
main = defaultMain
     [ bench "one validator loop" $ nfIO genesisBench
     ]
