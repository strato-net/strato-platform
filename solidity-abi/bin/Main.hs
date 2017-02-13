import Blockchain.Ethereum.Solidity.Parse
import Blockchain.Ethereum.Solidity.External.JSON

import qualified Data.Aeson.Encode.Pretty as Aeson
import qualified Data.ByteString.Lazy as BS

import Data.List
import Data.Maybe

import qualified Data.Map as Map

import System.Environment

main :: IO ()
main = do
  sourceFiles <- getArgs
  let (mainFile, imports) =
        fromMaybe (error "No source files given") $ uncons sourceFiles
  (mainSrc, sourceMap) <-
    if mainFile == "--stdin"
    then do
      s <- getContents
      return (s, Map.empty)
    else do
      sources <- sequence $ map readFile sourceFiles
      return (head sources, Map.fromList $ zip imports $ tail sources)
  let doImport i = Map.findWithDefault (error "Import not found") i sourceMap
      parsed = parse doImport mainFile mainSrc
  either print (BS.putStr . Aeson.encodePretty) $ jsonABI <$> parsed
