{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

module Main where

import Control.Monad (when)
import Data.ByteString (ByteString)
import qualified Data.ByteString as BS
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import Options.Applicative
import System.Exit (exitFailure, exitSuccess)

import Crypto.Curve.BabyJubJub
import Crypto.Curve.BabyJubJub.EdDSA

-- | Command line options
data Command
  = CmdInfo
  | CmdKeygen KeygenOpts
  | CmdSign SignOpts
  | CmdVerify VerifyOpts
  | CmdScalarMult ScalarMultOpts
  | CmdPointAdd PointAddOpts

data KeygenOpts = KeygenOpts
  { kgSecret :: String
  }

data SignOpts = SignOpts
  { signSecret :: String
  , signMessage :: String
  }

data VerifyOpts = VerifyOpts
  { verifyPubX :: String
  , verifyPubY :: String
  , verifyMessage :: String
  , verifyRx :: String
  , verifyRy :: String
  , verifyS :: String
  }

data ScalarMultOpts = ScalarMultOpts
  { smScalar :: String
  , smPointX :: Maybe String
  , smPointY :: Maybe String
  }

data PointAddOpts = PointAddOpts
  { paP1x :: String
  , paP1y :: String
  , paP2x :: String
  , paP2y :: String
  }

-- | Parser for command line options
opts :: ParserInfo Command
opts = info (commandParser <**> helper)
  ( fullDesc
  <> progDesc "Baby JubJub curve operations and EdDSA signatures"
  <> header "baby-jubjub-cli - A CLI tool for Baby JubJub cryptography"
  )

commandParser :: Parser Command
commandParser = subparser
  ( command "info" (info (pure CmdInfo) (progDesc "Show curve parameters"))
  <> command "keygen" (info (CmdKeygen <$> keygenParser) (progDesc "Generate key pair from secret"))
  <> command "sign" (info (CmdSign <$> signParser) (progDesc "Sign a message"))
  <> command "verify" (info (CmdVerify <$> verifyParser) (progDesc "Verify a signature"))
  <> command "scalar-mult" (info (CmdScalarMult <$> scalarMultParser) (progDesc "Scalar multiplication"))
  <> command "point-add" (info (CmdPointAdd <$> pointAddParser) (progDesc "Add two points"))
  )

keygenParser :: Parser KeygenOpts
keygenParser = KeygenOpts
  <$> strOption
      ( long "secret"
      <> short 's'
      <> metavar "HEX"
      <> help "32-byte secret key in hex"
      )

signParser :: Parser SignOpts
signParser = SignOpts
  <$> strOption
      ( long "secret"
      <> short 's'
      <> metavar "HEX"
      <> help "32-byte secret key in hex"
      )
  <*> strOption
      ( long "message"
      <> short 'm'
      <> metavar "HEX"
      <> help "Message to sign in hex"
      )

verifyParser :: Parser VerifyOpts
verifyParser = VerifyOpts
  <$> strOption (long "pub-x" <> metavar "INT" <> help "Public key X coordinate")
  <*> strOption (long "pub-y" <> metavar "INT" <> help "Public key Y coordinate")
  <*> strOption (long "message" <> short 'm' <> metavar "HEX" <> help "Message in hex")
  <*> strOption (long "sig-rx" <> metavar "INT" <> help "Signature R point X")
  <*> strOption (long "sig-ry" <> metavar "INT" <> help "Signature R point Y")
  <*> strOption (long "sig-s" <> metavar "INT" <> help "Signature S scalar")

scalarMultParser :: Parser ScalarMultOpts
scalarMultParser = ScalarMultOpts
  <$> strOption
      ( long "scalar"
      <> short 'n'
      <> metavar "INT"
      <> help "Scalar value"
      )
  <*> optional (strOption (long "point-x" <> metavar "INT" <> help "Point X coordinate (default: base point)"))
  <*> optional (strOption (long "point-y" <> metavar "INT" <> help "Point Y coordinate (default: base point)"))

pointAddParser :: Parser PointAddOpts
pointAddParser = PointAddOpts
  <$> strOption (long "p1-x" <> metavar "INT" <> help "First point X")
  <*> strOption (long "p1-y" <> metavar "INT" <> help "First point Y")
  <*> strOption (long "p2-x" <> metavar "INT" <> help "Second point X")
  <*> strOption (long "p2-y" <> metavar "INT" <> help "Second point Y")

main :: IO ()
main = do
  cmd <- execParser opts
  case cmd of
    CmdInfo -> cmdInfo
    CmdKeygen o -> cmdKeygen o
    CmdSign o -> cmdSign o
    CmdVerify o -> cmdVerify o
    CmdScalarMult o -> cmdScalarMult o
    CmdPointAdd o -> cmdPointAdd o

cmdInfo :: IO ()
cmdInfo = do
  putStrLn "Baby JubJub Curve Parameters"
  putStrLn "============================"
  putStrLn ""
  putStrLn $ "Field prime (p):    " ++ show fieldPrime
  putStrLn $ "Curve a:            " ++ show curveA
  putStrLn $ "Curve d:            " ++ show curveD
  putStrLn $ "Subgroup order (l): " ++ show subgroupOrder
  putStrLn $ "Cofactor (h):       " ++ show cofactor
  putStrLn ""
  putStrLn "Base Point (Generator):"
  putStrLn $ "  x: " ++ show basePointX
  putStrLn $ "  y: " ++ show basePointY
  putStrLn ""
  putStrLn "Curve equation: ax² + y² = 1 + dx²y²"

cmdKeygen :: KeygenOpts -> IO ()
cmdKeygen KeygenOpts{..} = do
  secretBytes <- parseHexArg "secret" kgSecret 32
  case privateKeyFromBytes secretBytes of
    Nothing -> do
      putStrLn "Error: Invalid secret key"
      exitFailure
    Just priv -> do
      let (PublicKey pub, _) = generateKeyPair priv
          (pubX, pubY) = case pub of
            Point x y -> (x, y)
            Infinity -> (0, 1)
      
      putStrLn "Key Generation"
      putStrLn "=============="
      putStrLn ""
      putStrLn $ "Secret (hex): " ++ BC.unpack (B16.encode secretBytes)
      putStrLn ""
      putStrLn "Public Key:"
      putStrLn $ "  x: " ++ show pubX
      putStrLn $ "  y: " ++ show pubY
      putStrLn ""
      putStrLn $ "On curve: " ++ show (isOnCurve pub)

cmdSign :: SignOpts -> IO ()
cmdSign SignOpts{..} = do
  secretBytes <- parseHexArg "secret" signSecret 32
  msgBytes <- parseHexArgVar "message" signMessage
  
  case privateKeyFromBytes secretBytes of
    Nothing -> do
      putStrLn "Error: Invalid secret key"
      exitFailure
    Just priv -> do
      let (PublicKey pub, _) = generateKeyPair priv
          (pubX, pubY) = case pub of
            Point x y -> (x, y)
            Infinity -> (0, 1)
          sig = sign priv msgBytes
          Signature rPoint s = sig
          (rx, ry) = case rPoint of
            Point x y -> (x, y)
            Infinity -> (0, 1)
      
      putStrLn "EdDSA Signature"
      putStrLn "==============="
      putStrLn ""
      putStrLn "Public Key:"
      putStrLn $ "  x: " ++ show pubX
      putStrLn $ "  y: " ++ show pubY
      putStrLn ""
      putStrLn $ "Message (hex): " ++ BC.unpack (B16.encode msgBytes)
      putStrLn ""
      putStrLn "Signature:"
      putStrLn $ "  R.x: " ++ show rx
      putStrLn $ "  R.y: " ++ show ry
      putStrLn $ "  S:   " ++ show s

cmdVerify :: VerifyOpts -> IO ()
cmdVerify VerifyOpts{..} = do
  let pubX = read verifyPubX :: Integer
      pubY = read verifyPubY :: Integer
      rx = read verifyRx :: Integer
      ry = read verifyRy :: Integer
      s = read verifyS :: Integer
  
  msgBytes <- parseHexArgVar "message" verifyMessage
  
  case mkPoint pubX pubY of
    Nothing -> do
      putStrLn "Error: Public key is not on curve"
      exitFailure
    Just pub -> case mkPoint rx ry of
      Nothing -> do
        putStrLn "Error: Signature R point is not on curve"
        exitFailure
      Just rPoint -> do
        let pubKey = PublicKey pub
            sig = Signature rPoint s
            valid = verify pubKey msgBytes sig
        
        putStrLn "EdDSA Verification"
        putStrLn "=================="
        putStrLn ""
        putStrLn $ "Valid: " ++ show valid
        
        if valid
          then exitSuccess
          else exitFailure

cmdScalarMult :: ScalarMultOpts -> IO ()
cmdScalarMult ScalarMultOpts{..} = do
  let scalar = read smScalar :: Integer
  
  point <- case (smPointX, smPointY) of
    (Nothing, Nothing) -> return basePoint
    (Just xs, Just ys) -> do
      let x = read xs :: Integer
          y = read ys :: Integer
      case mkPoint x y of
        Nothing -> do
          putStrLn "Error: Point is not on curve"
          exitFailure
        Just p -> return p
    _ -> do
      putStrLn "Error: Must specify both point-x and point-y, or neither"
      exitFailure
  
  let result = scalarMult scalar point
      (rx, ry) = case result of
        Point x y -> (x, y)
        Infinity -> (0, 1)
  
  putStrLn "Scalar Multiplication"
  putStrLn "====================="
  putStrLn ""
  putStrLn $ "Scalar: " ++ show scalar
  putStrLn ""
  putStrLn "Input Point:"
  case point of
    Point px py -> do
      putStrLn $ "  x: " ++ show px
      putStrLn $ "  y: " ++ show py
    Infinity -> putStrLn "  (infinity)"
  putStrLn ""
  putStrLn "Result:"
  case result of
    Point _ _ -> do
      putStrLn $ "  x: " ++ show rx
      putStrLn $ "  y: " ++ show ry
    Infinity -> putStrLn "  (infinity)"
  putStrLn ""
  putStrLn $ "On curve: " ++ show (isOnCurve result)

cmdPointAdd :: PointAddOpts -> IO ()
cmdPointAdd PointAddOpts{..} = do
  let p1x = read paP1x :: Integer
      p1y = read paP1y :: Integer
      p2x = read paP2x :: Integer
      p2y = read paP2y :: Integer
  
  p1 <- case mkPoint p1x p1y of
    Nothing -> do
      putStrLn "Error: First point is not on curve"
      exitFailure
    Just p -> return p
  
  p2 <- case mkPoint p2x p2y of
    Nothing -> do
      putStrLn "Error: Second point is not on curve"
      exitFailure
    Just p -> return p
  
  let result = pointAdd p1 p2
      (rx, ry) = case result of
        Point x y -> (x, y)
        Infinity -> (0, 1)
  
  putStrLn "Point Addition"
  putStrLn "=============="
  putStrLn ""
  putStrLn "P1:"
  putStrLn $ "  x: " ++ show p1x
  putStrLn $ "  y: " ++ show p1y
  putStrLn ""
  putStrLn "P2:"
  putStrLn $ "  x: " ++ show p2x
  putStrLn $ "  y: " ++ show p2y
  putStrLn ""
  putStrLn "P1 + P2:"
  putStrLn $ "  x: " ++ show rx
  putStrLn $ "  y: " ++ show ry
  putStrLn ""
  putStrLn $ "On curve: " ++ show (isOnCurve result)

-- | Parse a hex argument with expected length
parseHexArg :: String -> String -> Int -> IO ByteString
parseHexArg name hexStr expectedLen = do
  let cleaned = if take 2 hexStr == "0x" then drop 2 hexStr else hexStr
  case B16.decode (BC.pack cleaned) of
    Left err -> do
      putStrLn $ "Error: Invalid hex for " ++ name ++ ": " ++ err
      exitFailure
    Right bs -> do
      when (BS.length bs /= expectedLen) $ do
        putStrLn $ "Error: " ++ name ++ " must be " ++ show expectedLen ++ " bytes, got " ++ show (BS.length bs)
        exitFailure
      return bs

-- | Parse a hex argument with variable length
parseHexArgVar :: String -> String -> IO ByteString
parseHexArgVar name hexStr = do
  let cleaned = if take 2 hexStr == "0x" then drop 2 hexStr else hexStr
  case B16.decode (BC.pack cleaned) of
    Left err -> do
      putStrLn $ "Error: Invalid hex for " ++ name ++ ": " ++ err
      exitFailure
    Right bs -> return bs
