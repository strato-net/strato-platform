{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Trigger where

import Data.Int
import Database.PostgreSQL.Simple
import Database.PostgreSQL.Simple.Notification
import Data.ByteString.Char8 (unpack)

waitForNewBlock::Connection->IO ()
waitForNewBlock conn = do
  Notification _ notifChannel notifData <- getNotification conn
  putStr $ "Trigger on " ++ (unpack notifChannel) ++ " data is: " ++ (unpack notifData) ++ "\n"
  return ()
                  
setupTrigger::Connection->IO Int64
setupTrigger conn = do
    withTransaction conn $ execute conn
                        "drop trigger if exists newBlock on Unprocessed;\n\
                        \create or replace function newBlock() returns trigger language plpgsql as $$\
                        \begin\n\
                        \ perform pg_notify('new_block', NULL);\n\
                        \ return null;\n\
                        \end\n\
                        \$$;\n\
                        \create trigger newBlock after insert on Unprocessed for each row execute procedure newBlock();\n\
                        \listen new_block;\n" ()

                            
