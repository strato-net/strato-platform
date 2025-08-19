{-# LANGUAGE TemplateHaskell #-}

import Blockchain.Blockstanbul.Options ()
import Blockchain.Options ()
import Blockchain.Strato.Model.Options ()
import Blockchain.VMOptions ()
import Executable.EVMFlags ()
import HFlags
import qualified Language.Javascript.JSaddle.WKWebView as Native
import qualified Language.Javascript.JSaddle.Warp as Browser
import Strato.Options (flags_frontend_port, flags_gui)
import Strato.Run (runStrato)

main :: IO ()
main = do
  _ <- $initHFlags "STRATO"
  if flags_gui
    then do
      putStrLn "Starting native window interface..."
      runStrato Native.run
    else do
      putStrLn "Starting browser-based interface..."
      runStrato $ Browser.run flags_frontend_port