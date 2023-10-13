{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TypeApplications #-}

module Blockchain.SolidVM.TraceTools where

import Blockchain.SolidVM.SM
import Blockchain.SolidVM.SetGet
import Control.Monad
import Control.Monad.Change.Modify
import Control.Monad.IO.Class
import qualified Data.Map as M
import SolidVM.Model.SolidString
import Text.Format
import Text.Tools

showVariables :: MonadSM m => CallInfo -> m [String]
showVariables ci = do
  forM (M.toList $ localVariables ci) $ \(name, (_, var)) -> do
    val <- getVar var
    valueString <- showSM val
    return $ "    \"" ++ labelToString name ++ "\": " ++ valueString

getFullStackTrace :: MonadSM m => [CallInfo] -> m [String]
getFullStackTrace theCallStack = do
  sliceStrings <-
    forM theCallStack $ \slice -> do
      varString <- showVariables slice

      return $
        ("-----[variables for " ++ format (currentAccount slice) ++ "/" ++ labelToString (currentFunctionName slice) ++ "]----------------") :
        varString

  return $ concat sliceStrings

printFullStackTrace :: MonadSM m => m ()
printFullStackTrace = do
  theCallStack <- get (Proxy @[CallInfo])
  fullStackTrace <- getFullStackTrace theCallStack
  liftIO $ putStrLn $ grayBox $ concat $ map (wrap 150) fullStackTrace
