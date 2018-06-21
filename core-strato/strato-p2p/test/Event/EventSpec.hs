{-# LANGUAGE FlexibleContexts #-}


module Event.EventSpec where

import           Blockchain.Data.DataDefs
import           Blockchain.Data.Wire
import           Blockchain.NewEvent
import           Blockchain.Strato.Model.SHA
import           Control.Monad.State
import           Crypto.Types.PubKey.ECC
import           Data.Conduit
import qualified Data.Map                    as Map
import           Test.Hspec

shouldEmit :: (Eq i, Show i, Monad m) => Maybe i -> ConduitM i o m Expectation
shouldEmit theValue = (`shouldBe` theValue) <$> await

helloMsg :: Message
helloMsg =
  Hello { version = 4
        , clientId = "dummy"
        , capability = [ETH 19]
        , port = 0
        , nodeId = Point 0x1 0x1
        }

statusMsg :: Message
statusMsg =
  Status { protocolVersion = 0
         , networkID = 0
         , totalDifficulty = 0
         , latestHash = SHA 0
         , genesisHash = SHA 0
         }

dummyServerStatusMsg :: Message
dummyServerStatusMsg =
  Status { protocolVersion = 0
         , networkID = 0
         , totalDifficulty = 0
         , latestHash = SHA 0
         , genesisHash = SHA 0
         }

getPutAction :: (MonadState (Map.Map Int Int) m) => m Bool
getPutAction =  do
  theMapBefore <- get
  put (Map.insert 10 12 theMapBefore)
  theMapAfter <- get
  let theVal = Map.lookup 10 theMapAfter
  return (theVal == Just 12)

spec :: Spec
spec = do
  describe "monad transformer over map tests" $ do
    it "stateT get its puts for a map" $ do
      getPutBool <- evalStateT getPutAction Map.empty
      getPutBool `shouldBe` True

  describe "handshake tests" $ do
    let mapempty = Map.empty :: Map.Map SHA Block
    it "conduit sanity test - status gets through immediately" $ do
      join . runConduit $ yield statusMsg  .| shouldEmit (Just statusMsg)

    it "conduit sanity test - hello  gets through immediately" $ do
      join  . runConduit $ yield helloMsg .| shouldEmit (Just helloMsg)

    it "hello gets a status when we are the server" $ do
      let pipeline = yield (MsgEvt helloMsg)
                  .| handleEvents' Nothing
                  .| shouldEmit (Just dummyServerStatusMsg)
      join $ evalInMemoryServer (runConduit pipeline) mapempty

    it "hello gets a disconnect when we are the client" $ do
      let pipeline = yield (MsgEvt helloMsg)
                  .| handleEvents' Nothing
                  .| shouldEmit (Just (Disconnect BreachOfProtocol))
      join $ evalInMemoryClient (runConduit pipeline) mapempty

    it "ping gets pong" $ do
      let pipeline = yield (MsgEvt Ping)
                  .| handleEvents' Nothing
                  .| shouldEmit (Just Pong)
      join $ evalInMemoryClient (runConduit pipeline) mapempty
