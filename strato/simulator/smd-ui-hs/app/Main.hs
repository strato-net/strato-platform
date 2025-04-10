{-# LANGUAGE OverloadedStrings #-}

module Main where

import Language.Javascript.JSaddle.Warp (run)
import Language.Javascript.JSaddle.WKWebView (run)
import qualified Data.ByteString as BS
import Reflex.Dom.Core (mainWidget, mainWidgetWithCss)
import qualified Main.App as App

-- CSS file path
cssPath :: FilePath
cssPath = "src/Components/style.css"

-- Main function for browser-based interface
mainBrowser :: IO ()
mainBrowser = do
  putStrLn "Starting browser-based interface..."
  Language.Javascript.JSaddle.Warp.run 3000 $ mainWidget App.mainWidget

-- Main function for native window interface
mainNative :: IO ()
mainNative = do
  -- Read the CSS file and convert to Text
  css <- BS.readFile cssPath
  putStrLn "Starting native window interface..."
  Language.Javascript.JSaddle.WKWebView.run $ mainWidgetWithCss css App.mainWidget

-- Default main function (can be changed to mainBrowser or mainNative)
main :: IO ()
main = mainNative 