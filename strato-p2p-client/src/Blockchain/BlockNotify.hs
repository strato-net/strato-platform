{-# LANGUAGE OverloadedStrings, FlexibleContexts, TypeFamilies #-}

module Blockchain.BlockNotify (
  createBlockTrigger,
  blockNotificationSource
  ) where

import Conduit
import Control.Monad
import Control.Monad.Logger
import Control.Monad.Trans.Resource
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import Data.String
import qualified Data.Text as T
import qualified Database.Persist as SQL
import qualified Database.Persist.Postgresql as SQL
import qualified Database.PostgreSQL.Simple as PS
import Database.PostgreSQL.Simple.Notification

import Blockchain.Data.DataDefs
import Blockchain.Data.NewBlk
import Blockchain.DB.SQLDB
import Blockchain.ExtWord
import Blockchain.SHA
import Blockchain.EthConf

createBlockTrigger::(MonadIO m, MonadLogger m)=>
                    String->m ()
createBlockTrigger name = do
  conn <- liftIO $ PS.connectPostgreSQL connStr

  res2 <- liftIO $ PS.execute_ conn $ fromString $ "DROP TRIGGER IF EXISTS " ++ name ++ "_notify ON new_blk;\n\
\CREATE OR REPLACE FUNCTION " ++ name ++ "_notify() RETURNS TRIGGER AS $" ++ name ++ "_notify$ \n\ 
    \ BEGIN \n\
    \     PERFORM pg_notify('new_" ++ name ++ "', NEW.hash::text ); \n\
    \     RETURN NULL; \n\
    \ END; \n\
\ $" ++ name ++ "_notify$ LANGUAGE plpgsql; \n\
\ CREATE TRIGGER " ++ name ++ "_notify AFTER INSERT OR DELETE OR UPDATE ON new_blk FOR EACH ROW EXECUTE PROCEDURE " ++ name ++ "_notify();"

  liftIO $ PS.close conn

  logInfoN $ T.pack $ "created trigger with result: " ++ show res2

byteStringToSHA::B.ByteString->SHA
byteStringToSHA s =
  case B16.decode s of
   (s', "") -> SHA $ bytesToWord256 $ B.unpack s'
   _ -> error "byteString in wrong format"

blockNotificationSource::(MonadIO m, MonadBaseControl IO m, MonadResource m, MonadLogger m)=>
                         String->Source m (Block, Integer)
blockNotificationSource name = do
  conn <- liftIO $ PS.connectPostgreSQL connStr
  _ <- register $ PS.close conn

  pool <- liftIO $ runNoLoggingT $ SQL.createPostgresqlPool connStr' 20
  createBlockTrigger name

  forever $ do
    _ <- liftIO $ PS.execute_ conn $ fromString $ "LISTEN new_" ++ name ++ ";"
    logInfoN "about to listen for new block notifications"
    rowId <- liftIO $ fmap (byteStringToSHA . notificationData) $ getNotification conn
    logInfoN $ T.pack $ "########### block has been added: rowId=" ++ show rowId
    maybeBlock <- lift $ getBlockFromKey pool rowId
    case maybeBlock of
     Nothing -> error "wow, item was removed in notificationSource before I could get it....  This didn't seem like a likely occurence when I was programming, you should probably deal with this possibility now"
     Just (b, difficulty) -> yield (newBlkToBlock b, difficulty)

getBlockFromKey::(MonadIO m, MonadBaseControl IO m)=>
                 SQLDB->SHA->m (Maybe (NewBlk, Integer))
getBlockFromKey pool hash' = do
  maybeBlock <-
    SQL.runSqlPool (SQL.getBy $ TheHash hash') pool
  case maybeBlock of
   Nothing -> return Nothing
   Just b -> do
     return $ Just (SQL.entityVal b, 0)
{-       maybeBlock <-
         flip SQL.runSqlPool pool $ do
           SQL.get (blockDataRefBlockId bd)
       case maybeBlock of
        Just b -> return $ Just (b, blockDataRefTotalDifficulty bd, blockDataRefHash bd)
        Nothing -> error "block missing blockData in call to getBlockFromKey" -}
