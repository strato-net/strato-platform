{-# LANGUAGE OverloadedStrings #-}

module Backend.Server where

import           Control.Monad      (forever)
import           Data.Aeson         (encode, decode)
import qualified Data.ByteString    as B
import           Data.ByteString.Lazy (toStrict)
import           Data.Semigroup     ((<>))
import qualified Data.Text.IO       as T
import qualified Network.WebSockets as WS

--------------------------------------------------------------------------------
import           Common.Message
--------------------------------------------------------------------------------

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
        T.putStrLn $ "Pretending to compile: " <> txt
        let a = Ann 0 0 "this is not correct" True
        WS.sendTextData conn . toStrict . encode $ S2Cannotations [a]