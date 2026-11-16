{-# LANGUAGE OverloadedStrings, TemplateHaskell #-}
module Main where

import BlockApps.Logging (runLogging)
import Blockchain.SolidVM.CodeCollectionDB (codeCollectionFromSource)
import Blockchain.VMContext (runMemContextM)
import Control.Monad (void)
import Control.Monad.IO.Class (liftIO)
import qualified Data.ByteString as B
import qualified Data.Text as T
import qualified Data.Text.IO as T
import HFlags
import SolidVM.Source (renderCollection, renderContract, showErr)
import System.Exit (die)
import Control.Monad.Composable.Base (runEff)
import Blockchain.VMOptions ()
import Blockchain.Strato.Model.Options ()
import Blockchain.Wiring ()

main :: IO ()
main = do
  cliArgs <- $initHFlags "Emit the compiled Haskell actions for a Solidity source file"
  (path, selected) <- case cliArgs of
    [file] -> pure (file, Nothing)
    [file, contract] -> pure (file, Just (T.pack contract))
    _ -> die "Usage: solid-vm-source FILE [CONTRACT]"
  input <- B.readFile path
  void $ runEff . runLogging . runMemContextM (const $ pure Nothing) Nothing $ do
    (_, collection) <- codeCollectionFromSource False True input
    liftIO $ maybe renderCollection renderContract selected collection >>= \result -> case result of
      Left failures -> die $ T.unpack $ T.unlines [name <> ": " <> showErr err | (name, err) <- failures]
      Right source -> T.putStrLn source
