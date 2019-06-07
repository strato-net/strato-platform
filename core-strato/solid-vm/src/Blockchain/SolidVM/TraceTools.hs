
module Blockchain.SolidVM.TraceTools where

import           Control.Monad.IO.Class
import           Control.Monad.Trans.State
import qualified Data.Map                       as M

import           Blockchain.SolidVM.SM
import           Text.Format
import           Text.Tools



showVariables :: CallInfo -> [String]
showVariables ci = 
  map (\(name, value) -> "    \"" ++ name ++ "\": " ++ show (snd value))
  $ M.toList $ localVariables ci
  
getFullStackTrace :: [CallInfo] -> [String]
getFullStackTrace theCallStack = 
  concat $ map
  
  (\slice ->
    ("-----[variables for " ++ format (currentAddress slice) ++ "/" ++ currentFunctionName slice ++ "]----------------")
    : showVariables slice)
  
  theCallStack
  
printFullStackTrace :: SM ()
printFullStackTrace = do
  theCallStack <- gets callStack
  liftIO $ putStrLn $ grayBox $ concat $ map (wrap 150) $ getFullStackTrace theCallStack
