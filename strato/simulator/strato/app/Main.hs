{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE CPP #-}

import Blockchain.Blockstanbul.Options ()
import Blockchain.Options ()
import Blockchain.Strato.Model.Options ()
import Blockchain.VMOptions ()
import Executable.EVMFlags ()
import HFlags
import Language.Javascript.JSaddle.Monad (JSM)

#ifdef darwin
import qualified Language.Javascript.JSaddle.WKWebView as Native
#else
import qualified Language.Javascript.JSaddle.WebKitGTK as Native
#endif

import qualified Language.Javascript.JSaddle.Warp as Browser
import Strato.Options (flags_frontend_port, flags_gui)
import Strato.Run (runStrato)

nativeRun :: JSM () -> IO ()
nativeRun jsm = do
  putStrLn "Starting native window interface..."
  Native.run jsm

browserRun :: Int -> JSM () -> IO ()
browserRun port jsm = do
  putStrLn $ "Starting browser-based interface on port " ++ show port ++ "..."
  Browser.run port jsm

main :: IO ()
main = do
  _ <- $initHFlags "STRATO"
  if flags_gui
    then runStrato nativeRun
    else runStrato $ browserRun flags_frontend_port