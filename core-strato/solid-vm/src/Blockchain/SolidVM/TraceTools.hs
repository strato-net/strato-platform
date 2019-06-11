
module Blockchain.SolidVM.TraceTools where

import           Control.Monad
import           Control.Monad.IO.Class
import           Control.Monad.Trans.State
import qualified Data.Map                       as M

import           Blockchain.SolidVM.SM
import           Blockchain.SolidVM.SetGet
import           Text.Format
import           Text.Tools



showVariables :: CallInfo -> SM [String]
showVariables ci = do
  forM (M.toList $ localVariables ci) $ \(name, (_, var)) -> do
    val <- getVar var
    valueString <- showSM val
    return $ "    \"" ++ name ++ "\": " ++ valueString

  
getFullStackTrace :: [CallInfo] -> SM [String]
getFullStackTrace theCallStack = do
  sliceStrings <- 
    forM theCallStack $ \slice -> do
      varString <- showVariables slice
  
      return $ ("-----[variables for " ++ format (currentAddress slice) ++ "/" ++ currentFunctionName slice ++ "]----------------")
        : varString

  return $ concat sliceStrings
  
printFullStackTrace :: SM ()
printFullStackTrace = do
  theCallStack <- gets callStack
  fullStackTrace <- getFullStackTrace theCallStack
  liftIO $ putStrLn $ grayBox $ concat $ map (wrap 150) fullStackTrace
