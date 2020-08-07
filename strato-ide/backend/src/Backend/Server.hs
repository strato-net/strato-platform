{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Backend.Server where

import           Control.Monad      (forever)
import           Data.Aeson         (encode, decode)
import qualified Data.ByteString    as B
import           Data.ByteString.Lazy (toStrict)
import           Data.Semigroup     ((<>))
import           Data.Text
import qualified Data.Text.IO       as T
import qualified Network.WebSockets as WS

import           CheckContract

--------------------------------------------------------------------------------
import           Common.Message
--------------------------------------------------------------------------------

fakeOutput :: Text
fakeOutput = "\
\Line 180: error: cannot find symbol [in MyLinkedList.java]\
            \iter = iter.next;\
            \^\
  \symbol:   variable iter\
  \location: class MyLinkedList\
\Line 180: error: cannot find symbol [in MyLinkedList.java]\
            \iter = iter.next;\
                   \^\
  \symbol:   variable iter\
  \location: class MyLinkedList\
\Line 183: error: cannot find symbol [in MyLinkedList.java]\
        \Node bore = iter.prev;\
                    \^\
  \symbol:   variable iter\
  \location: class MyLinkedList\
\Line 185: error: cannot find symbol [in MyLinkedList.java]\
        \Ne after = iter.next;\
        \^\
  \symbol:   class Ne\
  \location: class MyLinkedList\
\Line 185: error: cannot find symbol [in MyLinkedList.java]\
        \Ne after = iter.next;\
                   \^\
  \symbol:   variable iter\
  \location: class MyLinkedList\
\Line 187: error: cannot find symbol [in MyLinkedList.java]\
        \before.next = after;\
        \^\
  \symbol:   variable before\
  \location: class MyLinkedList\
\Line 189: error: cannot find symbol [in MyLinkedList.java]\
        \after.prev = before;\
                     \^\
  \symbol:   variable before\
  \location: class MyLinkedList\
\7 errors" :: Text


application :: WS.ServerApp
application pending = do
  conn <- WS.acceptRequest pending
  WS.forkPingThread conn 30
  forever $ do
    msgbs <- WS.receiveData conn :: IO B.ByteString
    let msgC = decode $ WS.toLazyByteString msgbs :: Maybe C2S
    case msgC of
      Nothing -> T.putStrLn "Decoded msgC is nothing..."
      Just (C2Scompile txt) -> do
        T.putStrLn $ "Running through a dummy compiler: " <> txt
        let a = Ann 0 0 "this is not correct" True
        WS.sendTextData conn . toStrict . encode $ S2Cannotations [a]
      Just (C2SdebugCode txt) -> do
        T.putStrLn $ "Producing debug output for the following code: " <> txt
        WS.sendTextData conn . toStrict . encode $ S2CdebugCode fakeOutput
      Just (C2ScreateContractBundle contractName contractCode) -> do 
        let output = ("The contract named \"" <> contractName <> "\" was created")
        T.putStrLn $ "Creating contract named: " <> contractName
        -- T.putStrLn $ "Producing debug output for the following code: " <> contractCode
        -- WS.sendTextData conn . toStrict . encode $ S2CdebugCode fakeOutput
        WS.sendTextData conn . toStrict . encode $ S2CcreateContract output