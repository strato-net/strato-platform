{-# LANGUAGE CPP #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}

import Blockchain.Blockstanbul.Options ()
import Blockchain.Options ()
import Blockchain.Strato.Model.Options ()
import Blockchain.VMOptions ()
import Data.Maybe (fromMaybe)
import Executable.EVMFlags ()
import HFlags
import Language.Javascript.JSaddle.Monad (JSM)

#ifdef darwin_HOST_OS
import qualified Language.Javascript.JSaddle.WKWebView as Native
#else
import qualified Language.Javascript.JSaddle.WebKitGTK as Native
#endif

import Language.Javascript.JSaddle.Run       (syncPoint)
import Language.Javascript.JSaddle.Run.Files (indexHtml)
import Language.Javascript.JSaddle.WebSockets
import qualified Network.HTTP.Types as H
import qualified Network.Wai as W
import Network.WebSockets (defaultConnectionOptions)
import Network.Wai.Handler.Warp (defaultSettings, runSettings, setPort, setTimeout)
import Strato.Options (flags_frontend_port, flags_gui, flags_no_backend)
import Strato.Run (runStrato, runStratoUI)

nativeRun :: JSM () -> IO ()
nativeRun jsm = do
  putStrLn "Starting native window interface..."
  Native.run jsm

jsaddleAppWithPath :: W.Application
jsaddleAppWithPath req sendResponse =
  jsaddleAppWithPathOr
    (\_ _ -> sendResponse $ W.responseLBS H.status403 [("Content-Type", "text/plain")] "Forbidden")
    req sendResponse

jsaddleAppWithPathOr :: W.Application -> W.Application
jsaddleAppWithPathOr otherApp req sendResponse =
  fromMaybe (otherApp req sendResponse)
    (jsaddleAppPartialWithPath req sendResponse)

jsaddleAppPartialWithPath :: W.Request -> (W.Response -> IO W.ResponseReceived) -> Maybe (IO W.ResponseReceived)
jsaddleAppPartialWithPath req sendResponse = case (W.requestMethod req, W.pathInfo req) of
  ("GET", ["jsaddle.js"]) -> Just $ sendResponse $ W.responseLBS H.status200 [("Content-Type", "application/javascript")] $ jsaddleJs False
  ("GET", _) -> Just $ sendResponse $ W.responseLBS H.status200 [("Content-Type", "text/html")] indexHtml
  _ -> Nothing

browserRun :: Int -> JSM () -> IO ()
browserRun port jsm = do
  putStrLn $ "Starting browser-based interface on port " ++ show port ++ "..."
  runSettings (setPort port (setTimeout 3600 defaultSettings)) =<<
    jsaddleOr defaultConnectionOptions (jsm >> syncPoint) jsaddleAppWithPath

main :: IO ()
main = do
  _ <- $initHFlags "STRATO"
  let runner = if flags_no_backend
                 then runStratoUI
                 else runStrato
  if flags_gui
    then runner nativeRun
    else runner $ browserRun flags_frontend_port