{-# LANGUAGE FlexibleContexts, 
             FlexibleInstances,
             OverloadedStrings, 
             LambdaCase, 
             ScopedTypeVariables, 
             GeneralizedNewtypeDeriving,
             DeriveFunctor,
             DeriveAnyClass
#-}
             
module Blockchain.NewEvent (
  handleEvents'
, Event(..)
, InMemory
, runInMemory
, evalInMemory
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

type InMemory k v m = StateT (Map.Map k v) m

instance PeerMonad (InMemory SHA Block IO) where
  peerRole = return Server 
  peerNetworkID = return 0 
  peerGenesisHash = return (SHA 0) 
  peerEthVersion = return 0
  peerLatestHash = return (SHA 0)
  peerBestBlock = undefined 

runInMemory :: InMemory k v m a -> Map.Map k v -> m (a, Map.Map k v) 
runInMemory action s = runStateT action s 

evalInMemory :: (Monad m) => InMemory k v m a -> Map.Map k v -> m a 
evalInMemory action s = evalStateT action s 

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
        Client -> error "client role not implemented yet" 

    MsgEvt Status{} -> error "status handler unimplemented"
    MsgEvt Ping     -> error "ping handler unimplemented" 
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

