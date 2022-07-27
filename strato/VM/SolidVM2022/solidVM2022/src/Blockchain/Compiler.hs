
module Blockchain.Compiler where

import Control.Monad
import Data.Map (Map)
import qualified Data.Map as Map


import qualified Blockchain.AST1 as AST1
import qualified Blockchain.AST2 as AST2
import Blockchain.Contract

compile1 :: Map String AST2.Variable -> [AST1.Statement] -> Either String [AST2.Statement]
compile1 globals statements = 
  forM statements $ compileStatement1 globals

compileStatement1 :: Map String AST2.Variable -> AST1.Statement -> Either String AST2.Statement
compileStatement1 globals (AST1.Assign lexp1 rexp1) = do
  lexp2 <- convert1 globals lexp1
  rexp2 <- convert1 globals rexp1
  return $ AST2.Assign lexp2 rexp2
compileStatement1 globals (AST1.ExpressionStatement exp1) = do
  exp2 <- convert1 globals exp1
  return $ AST2.ExpressionStatement exp2


convert1 :: Map String AST2.Variable -> AST1.Expression -> Either String AST2.Expression
convert1 globals (AST1.Variable name) = do
  case Map.lookup name globals of
    Nothing -> Left $ "no variable of name: " ++ show name
    Just var -> return $ AST2.EVariable var
convert1 _ (AST1.Integer i) = return $ AST2.EInteger i
convert1 _ (AST1.String s) = return $ AST2.EString s
convert1 globals (AST1.Function name args1) = do
  args2 <-
    forM args1 $ \arg1 -> do
      convert1 globals arg1
  return $ AST2.EFunction $ getNamedFunction name args2
--convert1 _ x = error $ "missing case in convert1: " ++ show x


compileSingleLine :: AST2.Statement -> Either String (IO ())
compileSingleLine (AST2.Assign lExp rExp) = AST2.assign lExp rExp
compileSingleLine (AST2.ExpressionStatement e) = do
  getter <- AST2.getGetter e
  return $ do
    _ <- getter :: IO AST2.Value
    return ()

compile :: [AST2.Statement] -> Either String Contract
compile lines' = do
  compiledFunction <- compileLines lines'
  let x = AST2.Function compiledFunction [] :: AST2.Function (IO ())
  return $ Contract $ Map.singleton "constructor" $ AST2.AnyFunction x

compileLines :: [AST2.Statement] -> Either String (IO ())
compileLines [] = return (return ())
compileLines (x:rest) = do
  firstLine <- compileSingleLine x
  remainingLines <- compileLines rest
  return $ firstLine >> remainingLines

-----------------

getNamedFunction :: String -> [AST2.Expression] -> AST2.AnyFunction
getNamedFunction "inc" args = AST2.AnyFunction $ AST2.Function incFunc args
getNamedFunction "plus" args = AST2.AnyFunction $ AST2.Function plusFunc args
getNamedFunction "length" args = AST2.AnyFunction $ AST2.Function lengthFunc args
getNamedFunction "concat" args = AST2.AnyFunction $ AST2.Function concatFunc args
getNamedFunction "print" args = AST2.AnyFunction $ AST2.Function printFunc args
getNamedFunction name _ = error $ "Missing case in getNamedFunction: " ++ name

incFunc :: Integer -> IO Integer
incFunc x = return $ x + 1

plusFunc :: Integer -> Integer -> IO Integer
plusFunc x y = return $ x + y

lengthFunc :: String -> IO Integer
lengthFunc = return . toInteger . length

concatFunc :: String -> String -> IO String
concatFunc x y = return $ x ++ y

printFunc :: AST2.Value -> IO ()
printFunc = putStrLn . show
