module Debug where

import Blockchain.Data.BlockDB
import Blockchain.Data.DataDefs
import Blockchain.Data.Transaction
import Blockchain.Format
import Blockchain.SHA
import Blockchain.Quarry.Flags
import Control.Monad
import Control.Monad.IO.Class
import Database.Persist.Sql

debugPrint :: (MonadIO m) => String -> m ()
debugPrint s = when flags_qDebug $ liftIO $ putStr s

debugPrints :: (MonadIO m) => [String] -> m ()
debugPrints = debugPrint . concat

showHash :: SHA -> String
showHash h = format h

showKey :: BackendKey SqlBackend -> String
showKey SqlBackendKey{unSqlBackendKey = k} = show k

showBlockIds :: (Key Block, Key BlockDataRef) -> String
showBlockIds (BlockKey bbk, BlockDataRefKey bdbk) =
  "(bId: " ++ showKey bbk ++ ", bdId: " ++ showKey bdbk ++ ")"

showTXHashes :: Block -> String
showTXHashes b =
  concatMap (
    \t ->
    startDebugBlockLine ++ debugBlockIndent ++
    "TX Hash:   " ++ showHash (transactionHash t)) $
  blockReceiptTransactions b

showBlockHash :: Block -> String
showBlockHash b = showHash $ blockHash b

startDebugBlock :: String
startDebugBlock = "--- "

debugBlockIndent :: String
debugBlockIndent = "  "

startDebugBlockLine :: String
startDebugBlockLine = "\n" ++ debugBlockIndent

endDebugBlockLine :: String
endDebugBlockLine = "\n"

endDebugBlock :: String
endDebugBlock = "\n---\n"
