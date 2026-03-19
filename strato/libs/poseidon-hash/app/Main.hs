-- | Command-line Poseidon hash tool
--
-- Reads field elements from stdin, outputs hash to stdout.
--
-- Input format: integers (decimal or 0x hex) separated by whitespace
-- Output format: decimal integer (or hex with --hex flag)
--
-- Examples:
--   echo "1 2" | poseidon
--   echo "0x1 0x2" | poseidon
--   poseidon --hex < inputs.txt

module Main where

import Crypto.Hash.Poseidon
import System.Environment (getArgs)
import System.Exit (exitFailure)
import System.IO (hPutStrLn, stderr)
import Numeric (showHex, readHex)

main :: IO ()
main = do
  args <- getArgs
  let (outputHex, inputArgs) = parseArgs args
  
  input <- case inputArgs of
    [] -> getContents  -- Read from stdin
    _  -> return $ unwords inputArgs  -- Use command line args as input
  
  case parseInputs input of
    Left err -> do
      hPutStrLn stderr $ "Error: " ++ err
      exitFailure
    Right [] -> do
      hPutStrLn stderr "Error: at least one input required"
      exitFailure
    Right inputs -> do
      let result = poseidon (map toF inputs)
          output = if outputHex 
                   then "0x" ++ showHex (fromF result) ""
                   else show (fromF result)
      putStrLn output

parseArgs :: [String] -> (Bool, [String])
parseArgs args = 
  let isHexFlag s = s == "--hex" || s == "-x"
      hexFlag = any isHexFlag args
      rest = filter (not . isHexFlag) args
  in (hexFlag, rest)

parseInputs :: String -> Either String [Integer]
parseInputs input = 
  let tokens = words input
  in mapM parseToken tokens

parseToken :: String -> Either String Integer
parseToken s
  | null s = Left "empty token"
  | take 2 s == "0x" || take 2 s == "0X" = 
      case readHex (drop 2 s) of
        [(n, "")] -> Right n
        _ -> Left $ "invalid hex: " ++ s
  | all isDigit s = Right (read s)
  | otherwise = Left $ "invalid number: " ++ s
  where
    isDigit c = c >= '0' && c <= '9'
