{-# LANGUAGE TemplateHaskell #-}

import           Blockchain.Mining.Options ()
import           Blockchain.Output

import           Control.Monad.Logger
import           HFlags

import           Executable.StratoAdit

main :: IO ()
main = do
  s <- $initHFlags "Pluggable mining module for Strato"
  putStrLn $ "strato-adit runs with arguments: " ++ unlines s
  runLoggingT stratoAdit (printLogMsg' True True)

