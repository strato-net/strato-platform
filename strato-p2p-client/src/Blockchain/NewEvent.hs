{-# LANGUAGE FlexibleContexts, 
             FlexibleInstances,
             OverloadedStrings, 
             LambdaCase, 
             ScopedTypeVariables, 
             GeneralizedNewtypeDeriving -- ,
             -- DeriveFunctor,
             -- DeriveAnyClass
#-}
             
module Blockchain.NewEvent (
  handleEvents'
, Event(..)
, InMemoryServer
, InMemoryClient
, runInMemoryServer
, evalInMemoryServer
, runInMemoryClient
, evalInMemoryClient
) where


import Data.Conduit
import Blockchain.Data.Wire
import Blockchain.Data.DataDefs
-- import Blockchain.Data.BlockDB
import Blockchain.Strato.Model.SHA
-- import Crypto.Types.PubKey.ECC

import Control.Monad.Trans
import Control.Monad.Trans.State
import qualified Data.Map as Map

data Event = MsgEvt Message | NewTX RawTransaction | NewBL Block Integer | TimerEvt deriving (Show)
data Role = Client | Server

class Monad m => PeerMonad m where
  peerRole :: m Role
  peerNetworkID :: m Int 
  peerEthVersion :: m Int
  peerGenesisHash :: m SHA
  peerLatestHash :: m SHA
  peerBestBlock :: m Block


newtype InMemoryServer k v a = InMemoryServer { unInMemoryServer :: StateT (Map.Map k v) IO a } 
  deriving (Functor, Applicative, Monad)

instance PeerMonad (InMemoryServer SHA Block)  where
  peerRole = return Server 
  peerNetworkID = return 0 
  peerGenesisHash = return (SHA 0) 
  peerEthVersion = return 0
  peerLatestHash = return (SHA 0)
  peerBestBlock = undefined 

runInMemoryServer :: InMemoryServer k v a -> Map.Map k v ->  IO (a, Map.Map k v) 
runInMemoryServer action s = runStateT ( unInMemoryServer action ) s 

evalInMemoryServer :: InMemoryServer k v a -> Map.Map k v -> IO a 
evalInMemoryServer action s = evalStateT ( unInMemoryServer action ) s 

newtype InMemoryClient k v a = InMemoryClient { unInMemoryClient :: StateT (Map.Map k v) IO a }
  deriving (Functor, Applicative, Monad)


instance PeerMonad (InMemoryClient SHA Block) where
  peerRole = return Client
  peerNetworkID = return 0 
  peerGenesisHash = return (SHA 0) 
  peerEthVersion = return 0
  peerLatestHash = return (SHA 0)
  peerBestBlock = undefined 

runInMemoryClient :: InMemoryClient k v a -> Map.Map k v -> IO (a, Map.Map k v) 
runInMemoryClient action s = runStateT ( unInMemoryClient action ) s 

evalInMemoryClient :: InMemoryClient k v a -> Map.Map k v -> IO a 
evalInMemoryClient action s = evalStateT ( unInMemoryClient action ) s 

handleEvents' :: (PeerMonad m) => t -> ConduitM Event Message m ()
handleEvents' _ = awaitForever $ \case
    MsgEvt Hello{}  -> do
      theLatest <- lift peerLatestHash 
      theVersion <- lift peerEthVersion
      theNetworkID <- lift peerNetworkID 
      theGenesisBlockHash <- lift peerGenesisHash
      
      role <- lift peerRole
      -- _ <- lift peerBestBlock
      
      case role of 
        Server -> 
         yield Status{
                 protocolVersion=theVersion,
                 networkID=theNetworkID,
                 totalDifficulty=0,
                 latestHash=theLatest,
                 genesisHash=theGenesisBlockHash
               }
        Client ->
         yield (Disconnect BreachOfProtocol)

    MsgEvt Status{} -> error "status handler unimplemented"
    MsgEvt Ping     -> yield Pong 
    MsgEvt (Transactions _) -> error "transaction handler unimplemented" 
    MsgEvt (NewBlock _  _) -> error "NewBlock handler unimplemented" 
    MsgEvt (NewBlockHashes _) -> error "NewBlockHashes handler unimplemented" 
    MsgEvt (GetBlockHeaders (BlockHash _) _ _ _ ) -> error "GetBlockHeaders (BlockHash _) handler unimplemented"
    MsgEvt (GetBlockHeaders (BlockNumber _) _ _ _) -> error "GetBlockHeaders (BlockNumber _) handler unimplemented" 
    MsgEvt (BlockHeaders _) -> error "BlockHeaders handler unimplemented"
    MsgEvt (GetBlockBodies []) -> do
      bestBlk <- lift peerBestBlock
      error $ "GetBlockBodies handler unimplemented" ++ (show bestBlk) 
    MsgEvt (BlockBodies []) -> error "BlockBodies [] handler unimplemented" 
    MsgEvt (BlockBodies _) -> error "BlockBodies bodies handler unimplemented" 
    MsgEvt (Disconnect _) -> error "Disconnect handler unimplemented" 
    NewTX _ -> error "NewTX handler unimplemented"
    NewBL _ _ -> error "NewBL handler unimplemented" 
    TimerEvt -> error "TimerEvent handler unimplemented" 
    event -> error $ "unrecognized event: " ++ show event

