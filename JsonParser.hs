{-# LANGUAGE OverloadedStrings #-}
import Control.Monad
import Data.Aeson
import Data.ByteString.Lazy.Char8 (pack, concat)
import Data.List hiding (concat)
import qualified Data.Map as Map
import qualified Data.Text as T
import System.CPUTime
import System.Environment
import System.IO
import Prelude hiding (concat)

import Blockchain.Data.DataDefs
import Blockchain.Data.Json
import Blockchain.Data.Transaction

main = do
    args <- getArgs
    let count = read $ head args :: Int
    let json i = concat ["{\"nonce\":\"", pack (show i), "\",\"gasPrice\":\"1\",\"gasLimit\":\"3141592\",\"to\":\"000000000000000000000000000000000000000a\",\"value\":\"0\",\"codeOrData\":\"\",\"from\":\"000000000000000000000000000000000000abcd\",\"r\":\"e545f18e6cdfc4e6e4cf84b465f6ef294e93296beed41b1083a36eaaa2f7a2b\",\"s\":\"880f002407d6e3083e2ba82fe842ea2335a6869a446212071b334658a1b1d942\",\"v\":\"1b\",\"hash\":\"9a6b7d7b916c5aaac798b66c2401880818457d83370f55fd15139d66974bdd73\"}"]

    time0 <- getCPUTime
    forM_ [1..count] $ \i -> print (decode $ json i :: Maybe RawTransaction')
    time1 <- getCPUTime

    hPrint stderr $ "Time elapsed for " ++ show count ++ " json parsings: " ++ (show $ (fromRational $ toRational $ time1 - time0 :: Double) / 1e12) ++ "s"
