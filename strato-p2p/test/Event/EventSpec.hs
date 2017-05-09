{-# LANGUAGE FlexibleContexts #-}


module Event.EventSpec where

import Test.Hspec
import Blockchain.NewEvent
import Data.Conduit
import Blockchain.Data.Wire
import Blockchain.Strato.Model.SHA
import Crypto.Types.PubKey.ECC
import qualified Data.Map as Map
import Blockchain.Data.DataDefs
import Control.Monad.State

upstreamShouldImmediatelyEmit :: (Eq i, Show i, Monad m) => Maybe i -> ConduitM i o m Expectation 
upstreamShouldImmediatelyEmit theValue = do
  someVal <- await
  return $ someVal `shouldBe` theValue

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

disconnectProtocolBreach :: Message
disconnectProtocolBreach = Disconnect BreachOfProtocol

helloConduit :: (Monad m) => ConduitM () Message m ()
helloConduit = yield helloMsg

helloEventConduit :: (Monad m) => ConduitM () Event m ()
helloEventConduit = yield (MsgEvt helloMsg) 

pingEventConduit :: (Monad m) => ConduitM () Event m ()
pingEventConduit = yield (MsgEvt Ping) 

statusConduit :: (Monad m) => ConduitM () Message m ()
statusConduit = yield statusMsg

getPutAction :: (MonadState (Map.Map Int Int) m) => m Bool
getPutAction =  do
  theMapBefore <- get 
  put (Map.insert 10 12 theMapBefore)
  theMapAfter <- get
  let theVal = Map.lookup 10 theMapAfter  
  return (theVal == Just 12)

upstreamStatusChecker :: ConduitM Message o (InMemoryServer SHA Block) Expectation 
upstreamStatusChecker = upstreamShouldImmediatelyEmit (Just dummyServerStatusMsg)

upstreamDisconnectChecker :: ConduitM Message o (InMemoryClient SHA Block) Expectation 
upstreamDisconnectChecker = upstreamShouldImmediatelyEmit (Just disconnectProtocolBreach)

upstreamPingPong :: ConduitM Message o (InMemoryClient SHA Block) Expectation 
upstreamPingPong = upstreamShouldImmediatelyEmit (Just Pong)

spec :: Spec
spec = do
  describe "monad transformer over map tests" $ do
    it "stateT get its puts for a map" $ do
      getPutBool <- evalStateT getPutAction Map.empty 
      getPutBool `shouldBe` True      

--    it "InMemory model gets and puts blocks" $ do
      
  describe "handshake tests" $ do
    it "conduit sanity test - status gets through immediately" $ do
      let statusDetector = upstreamShouldImmediatelyEmit (Just statusMsg) :: Sink Message IO Expectation
      val  <- statusConduit $$ statusDetector 
      val   
      
    it "conduit sanity test - hello  gets through immediately" $ do
      let helloDetector = upstreamShouldImmediatelyEmit (Just helloMsg) :: Sink Message IO Expectation
      val'  <- helloConduit $$ helloDetector 
      val'

    it "hello gets a status when we are the server" $ do
      let handleEventsEmitsStatusSink = handleEvents' Nothing =$= upstreamStatusChecker          
          conduitStartAction = helloEventConduit $$ handleEventsEmitsStatusSink 
      
      helloGetsStatus <- evalInMemoryServer conduitStartAction (Map.empty :: Map.Map SHA Block) 
      helloGetsStatus      
    
    it "hello gets a disconnect when we are the client" $ do
       let handleEventsEmitsDisconnectSink = handleEvents' Nothing =$= upstreamDisconnectChecker          
           conduitStartAction' = helloEventConduit $$ handleEventsEmitsDisconnectSink 
      
       helloGetsDisconnect <- evalInMemoryClient conduitStartAction' (Map.empty :: Map.Map SHA Block) 
       helloGetsDisconnect      
    
    it "ping gets pong" $ do
       let handleEventsEmitsPongSink = handleEvents' Nothing =$= upstreamPingPong
           conduitStartAction'' = pingEventConduit $$ handleEventsEmitsPongSink

       pingGetsPong <- evalInMemoryClient conduitStartAction'' (Map.empty :: Map.Map SHA Block)
       pingGetsPong
