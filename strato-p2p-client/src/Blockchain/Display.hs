
module Blockchain.Display (
  displayMessage,
  tap
  ) where


import Control.Monad.Logger
import Control.Monad.IO.Class
import Control.Monad.Trans
import Data.Conduit
import qualified Data.Text as T


import qualified Blockchain.Colors as CL
import Blockchain.Data.BlockHeader
import Blockchain.Format
import Blockchain.Data.Wire

prefix::Bool->String->String
prefix True "" = CL.green "msg>>>>>: "
prefix False "" = CL.cyan "msg<<<<: "
prefix True peerName = CL.green $ peerName ++ " >>>>>: "
prefix False peerName = CL.cyan $ peerName ++ " <<<<: "

--This must exist somewhere already
tap::MonadIO m=>(a->m ())->Conduit a m a
tap f = do
  awaitForever $ \x -> do
      lift $ f x
      yield x
      
displayMessage::MonadLogger m=>Bool->String->Message->m ()
displayMessage _ _ Ping = return ()
displayMessage _ _ Pong = return ()
displayMessage outbound peerName (Transactions transactions) = do
  logInfoN $ T.pack $ prefix outbound peerName ++ CL.blue "Transactions: " ++ "(Received " ++ show (length transactions) ++ " transactions)"
displayMessage outbound peerName (BlockHeaders []) = do
  logInfoN $ T.pack $ prefix outbound peerName ++ CL.blue "BlockHeaders: No headers"
displayMessage outbound peerName (BlockHeaders headers) = do
  logInfoN $ T.pack $ prefix outbound peerName ++ CL.blue "BlockHeaders: " ++ "(" ++ show (length headers) ++ " new headers ending with #" ++ show (number $ last $ headers) ++ ")"
displayMessage outbound peerName (GetBlockBodies hashes) =
  logInfoN $ T.pack $ prefix outbound peerName ++ CL.blue "GetBlockBodies" ++ " (" ++ show (length hashes) ++ " hashes)"
displayMessage outbound peerName (BlockBodies bodies) = do
  let transactionCount = length $ concat $ map fst bodies
  logInfoN $ T.pack $ prefix outbound peerName ++ CL.blue "BlockBodies: "
    ++ "(" ++ show (length bodies)
    ++ " bodies, includes " ++ show transactionCount
    ++ " transaction" ++ (if transactionCount == 1 then "" else "s") ++ ")"
displayMessage outbound peerName msg =
  logInfoN $ T.pack $ (prefix outbound peerName) ++ format msg
