{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}

module Blockchain.Display (
  displayMessage,
  tap
  ) where


import           Control.Monad.IO.Class
import           Control.Monad.Logger
import           Control.Monad.Trans
import           Data.Conduit
import qualified Data.Text                   as T


import qualified Blockchain.Colors           as CL
import           Blockchain.Data.BlockHeader
import           Blockchain.Data.Wire
import           Blockchain.Format

prefix :: Bool -> String -> String
prefix True ""        = CL.green "msg send: "
prefix False ""       = CL.cyan  "msg recv: "
prefix True peerName  = CL.green $ peerName ++ " send: "
prefix False peerName = CL.cyan  $ peerName ++ " recv: "

--This must exist somewhere already
tap :: MonadIO m => (a -> m ()) -> Conduit a m a
tap f = awaitForever $ \x -> lift (f x) >> yield x

displayMessage :: MonadLogger m => Bool -> String -> Message -> m ()
displayMessage _ _ Ping = return ()
displayMessage _ _ Pong = return ()
displayMessage outbound peerName (Transactions transactions) = do
  $logInfoS "displayMessage" $ T.pack $ prefix outbound peerName ++ CL.blue "Transactions: " ++ "(Received " ++ show (length transactions) ++ " transactions)"
displayMessage outbound peerName (BlockHeaders []) = do
  $logInfoS "displayMessage" $ T.pack $ prefix outbound peerName ++ CL.blue "BlockHeaders: No headers"
displayMessage outbound peerName (BlockHeaders headers) = do
  $logInfoS "displayMessage" $ T.pack $ prefix outbound peerName ++ CL.blue "BlockHeaders: " ++ "(" ++ show (length headers) ++ " new headers ending with #" ++ show (number $ last $ headers) ++ ")"
displayMessage outbound peerName (GetBlockBodies hashes) =
  $logInfoS "displayMessage" $ T.pack $ prefix outbound peerName ++ CL.blue "GetBlockBodies" ++ " (" ++ show (length hashes) ++ " hashes)"
displayMessage outbound peerName (BlockBodies bodies) = do
  let transactionCount = length $ concat $ map fst bodies
  $logInfoS "displayMessage" $ T.pack $ prefix outbound peerName ++ CL.blue "BlockBodies: "
    ++ "(" ++ show (length bodies)
    ++ " bodies, includes " ++ show transactionCount
    ++ " transaction" ++ (if transactionCount == 1 then "" else "s") ++ ")"
displayMessage outbound peerName msg =
  $logDebugS "displayMessage" $ T.pack $ (prefix outbound peerName) ++ format msg
