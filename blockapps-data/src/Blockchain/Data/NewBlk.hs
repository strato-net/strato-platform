{-# LANGUAGE OverloadedStrings, ForeignFunctionInterface #-}
{-# LANGUAGE EmptyDataDecls             #-}
{-# LANGUAGE FlexibleContexts           #-}
{-# LANGUAGE GADTs                      #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses      #-}
{-# LANGUAGE OverloadedStrings          #-}
{-# LANGUAGE QuasiQuotes                #-}
{-# LANGUAGE TemplateHaskell            #-}
{-# LANGUAGE TypeFamilies               #-}
{-# LANGUAGE ScopedTypeVariables        #-}
{-# OPTIONS_GHC -fno-warn-orphans       #-}


module Blockchain.Data.NewBlk (
  NewBlk(..),
  getNewBlk,
  putNewBlk,
  blockToNewBlk,
  newBlkToBlock
) where 

import Control.Exception.Lifted

import Database.Persist hiding (get)
import qualified Database.Persist.Postgresql as SQL

import Blockchain.DB.SQLDB

import Blockchain.Data.BlockDB
import Blockchain.SHA
import Blockchain.Data.DataDefs

import Control.Monad.Trans.Resource

--import Debug.Trace

getNewBlk::(HasSQLDB m, MonadResource m, MonadBaseControl IO m)=>
          SHA->m (Maybe NewBlk)
getNewBlk h = do
  db <- getSQLDB
  res <- runResourceT $
    SQL.runSqlPool (SQL.getBy $ TheHash h) db

  return $ fmap entityVal res

putNewBlk::HasSQLDB m=>
           NewBlk->m ()
putNewBlk blk = do
  db <- getSQLDB
  (_::Either SomeException (Key NewBlk)) <- try $ runResourceT $
                                  flip SQL.runSqlPool db $
                                  SQL.insert blk

  return ()

blockToNewBlk::Block->NewBlk
blockToNewBlk b@Block{blockBlockData=bd,blockReceiptTransactions=t,blockBlockUncles=u} =
  NewBlk {
    newBlkHash=blockHash b,
    newBlkBlockData=bd,
    newBlkReceiptTransactions=t,
    newBlkBlockUncles=u
    }

newBlkToBlock::NewBlk->Block
newBlkToBlock NewBlk{newBlkBlockData=bd,newBlkReceiptTransactions=t,newBlkBlockUncles=u} =
  Block {
    blockBlockData=bd,
    blockReceiptTransactions=t,
    blockBlockUncles=u
    }
