{-# LANGUAGE TemplateHaskell #-}

import Blockchain.Blockstanbul.Options ()
import Blockchain.Options ()
import Blockchain.Strato.Model.Options ()
import Blockchain.VMOptions ()
import Executable.EVMFlags ()
import HFlags
import Language.Javascript.JSaddle.WKWebView (run)
import Strato.Options ()
import Strato.Run (runStrato)

main :: IO ()
main = do
  _ <- $initHFlags "STRATO Browser"
  putStrLn "Starting native window interface..."
  runStrato run