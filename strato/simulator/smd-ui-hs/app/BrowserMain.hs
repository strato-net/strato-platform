{-# LANGUAGE TemplateHaskell #-}

import Blockchain.Blockstanbul.Options ()
import Blockchain.Options ()
import Blockchain.Strato.Model.Options ()
import Blockchain.VMOptions ()
import Executable.EVMFlags ()
import HFlags
import Language.Javascript.JSaddle.Warp (run)
import Strato.Options (flags_frontend_port)
import Strato.Run (runStrato)

main :: IO ()
main = do
  _ <- $initHFlags "STRATO Browser"
  putStrLn "Starting browser-based interface..."
  runStrato $ run flags_frontend_port