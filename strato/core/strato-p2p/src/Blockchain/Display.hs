{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Display
  ( displayMessage,
    MsgDirection (..),
  )
where

import BlockApps.Logging
import Blockchain.Data.BlockHeader
import Blockchain.Data.Wire
import qualified Data.Text as T
import qualified Text.Colors as CL
import Text.Format

data MsgDirection = Inbound | Outbound deriving (Eq, Ord)

prefix :: MsgDirection -> String -> String
prefix Outbound "" = CL.green "msg send: "
prefix Inbound "" = CL.cyan "msg recv: "
prefix Outbound peerName = CL.green $ peerName ++ " send: "
prefix Inbound peerName = CL.cyan $ peerName ++ " recv: "

displayMessage :: MonadLogger m => MsgDirection -> String -> Message -> m ()
displayMessage _ _ Ping = return ()
displayMessage _ _ Pong = return ()
displayMessage dir peerName (Transactions transactions) = do
  $logInfoS "displayMessage" $ T.pack $ prefix dir peerName ++ CL.blue "Transactions: " ++ "(Received " ++ show (length transactions) ++ " transactions)"
displayMessage dir peerName (BlockHeaders []) = do
  $logInfoS "displayMessage" $ T.pack $ prefix dir peerName ++ CL.blue "BlockHeaders: No headers"
displayMessage dir peerName (BlockHeaders headers) = do
  $logInfoS "displayMessage" $ T.pack $ prefix dir peerName ++ CL.blue "BlockHeaders: " ++ "(" ++ show (length headers) ++ " new headers ending with #" ++ show (number $ last $ headers) ++ ")"
displayMessage dir peerName (GetBlockBodies hashes) =
  $logInfoS "displayMessage" $ T.pack $ prefix dir peerName ++ CL.blue "GetBlockBodies" ++ " (" ++ show (length hashes) ++ " hashes)"
displayMessage dir peerName (BlockBodies bodies) = do
  let transactionCount = length $ concat $ map fst bodies
  $logInfoS "displayMessage" $
    T.pack $
      prefix dir peerName ++ CL.blue "BlockBodies: "
        ++ "("
        ++ show (length bodies)
        ++ " bodies, includes "
        ++ show transactionCount
        ++ " transaction"
        ++ (if transactionCount == 1 then "" else "s")
        ++ ")"
displayMessage dir peerName (ChainDetails cInfos) = do
  let chainIds = fst <$> cInfos
  $logInfoS "displayMessage" $
    T.pack $
      prefix dir peerName ++ CL.blue "ChainDetails: "
        ++ concat (map (\cId -> "\n  " ++ format cId) chainIds)
displayMessage dir peerName msg =
  $logInfoS "displayMessage" $ T.pack $ (prefix dir peerName) ++ format msg
