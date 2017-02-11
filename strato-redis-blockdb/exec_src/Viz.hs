{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE DeriveDataTypeable #-}
{-# OPTIONS -fno-warn-unused-top-binds #-}
{-# OPTIONS -fno-warn-missing-signatures #-}

module Main where

import           Data.Tree
import           Diagrams.TwoD.Layout.Tree
import           Diagrams.Prelude hiding (option)
--import           Diagrams.Backend.Canvas.CmdLine
import           Diagrams.Backend.Html5.CmdLine
import           Options.Applicative as OA
import           Data.Data

import           Blockchain.Data.ArbitraryInstances()
import           Blockchain.Data.BlockDB
import           Blockchain.Strato.RedisBlockDB.Test.Chain

data TreeOpts = TreeOpts
  { _depth   :: Maybe Int 
  , _sibling :: Maybe Int  
  } deriving (Show, Data, Typeable)

treeOpts :: Parser TreeOpts
treeOpts = TreeOpts
  <$> (optional . option auto)
      (long "depth" OA.<> short 'd'
    OA.<> metavar "DEPTH"
    OA.<> help "Desired DEPTH of the tree")
  <*> (optional . option auto)
      (long "sibling" OA.<> short 's'
    OA.<> metavar "SIBLING"
    OA.<> help "Desired maxSibling count of the tree")

symmTree :: Tree BlockData -> Diagram B
symmTree t =
    renderTree ((Diagrams.Prelude.<> circle 1 # fc white) . text )
               (~~)
               (symmLayout' (with & slHSep .~ 4 & slVSep .~ 4) (prettyTree' t))
    # centerXY # pad 2.1
        
main :: IO ()
main = do
    g <- makeGenesisBlock
    t <- buildTree g 20 3
--    putStrLn $ showTree t
    mainWith $ symmTree t # frame 0.1
