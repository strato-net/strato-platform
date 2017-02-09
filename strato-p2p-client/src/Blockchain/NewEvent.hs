{-# LANGUAGE FlexibleContexts, OverloadedStrings, LambdaCase, ScopedTypeVariables #-}

module Blockchain.NewEvent (
  handleEvents'
 ) where

import Data.Conduit
import Blockchain.Data.Wire
import Blockchain.Data.DataDefs

--handleEvents :: (MonadIO m, HasSQLDB m, RBDB.HasRedisBlockDB m, MonadState Context m, MonadLogger m)
--             =>  DebugMode -> PPeer -> Conduit Event m Message

data Event = MsgEvt Message | NewTX RawTransaction | NewBL Block Integer | TimerEvt deriving (Show)

handleEvents' :: Monad m => t -> ConduitM Event o m ()
handleEvents' _ = awaitForever $ \case
    MsgEvt Hello{}  -> error "hello handler unimplemented"
    MsgEvt Status{} -> error "status handler unimplemented"
    MsgEvt Ping     -> error "ping handler unimplemented" 
    MsgEvt (Transactions _) -> error "transaction handler unimplemented" 
    MsgEvt (NewBlock _  _) -> error "NewBlock handler unimplemented" 
    MsgEvt (NewBlockHashes _) -> error "NewBlockHashes handler unimplemented" 
    MsgEvt (GetBlockHeaders (BlockHash _) _ _ _ ) -> error "GetBlockHeaders (BlockHash _) handler unimplemented"
    MsgEvt (GetBlockHeaders (BlockNumber _) _ _ _) -> error "GetBlockHeaders (BlockNumber _) handler unimplemented" 
    MsgEvt (BlockHeaders _) -> error "BlockHeaders handler unimplemented"
    MsgEvt (GetBlockBodies []) -> error "GetBlockBodies handler unimplemented" 
    MsgEvt (BlockBodies []) -> error "BlockBodies [] handler unimplemented" 
    MsgEvt (BlockBodies _) -> error "BlockBodies bodies handler unimplemented" 
    MsgEvt (Disconnect _) -> error "Disconnect handler unimplemented" 
    NewTX _ -> error "NewTX handler unimplemented"
    NewBL _ _ -> error "NewBL handler unimplemented" 
    TimerEvt -> error "TimerEvent handler unimplemented" 
    event -> error $ "unrecognized event: " ++ show event

