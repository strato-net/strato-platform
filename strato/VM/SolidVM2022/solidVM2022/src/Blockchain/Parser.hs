
module Blockchain.Parser where

--import Data.Functor.Identity
import qualified Data.Map as Map
import Text.Parsec

import qualified Blockchain.AST1 as AST1
import qualified Blockchain.AST1.Contract as AST1
import qualified Blockchain.AST1.FunctionDefinition as AST1

parseContract :: Parsec String () AST1.Contract
parseContract = do
  spaces
  _ <- string "contract"
  spaces
  name <- many1 alphaNum
  spaces
  _ <- string "{"
  spaces
  functions <- many parseFunction
  spaces
  _ <- string "}"
  spaces
  return $ AST1.Contract {AST1.name = name, AST1.functions = Map.fromList functions}


parseFunction :: Parsec String () (String, AST1.FunctionDefinition)
parseFunction = do
  _ <- string "function"
  spaces
  name <- many1 alphaNum
  spaces
  _ <- string "("
  spaces
  _ <- string ")"
  spaces
  _ <- string "{"
  spaces
  statements <- parseStatements
  spaces
  _ <- string "}"
  
  return $ (name, AST1.FunctionDefinition statements)

--I'm filling this in with dummy code for the moment....
parseStatements :: Parsec String () [AST1.Statement]
parseStatements = return    
        [
          AST1.ExpressionStatement (AST1.Function "print" [AST1.Integer 77]),
          AST1.ExpressionStatement (AST1.Function "print" [AST1.String "abcd"]),
          
          AST1.ExpressionStatement $ AST1.Function "print" [AST1.Function "concat" [AST1.String "1", AST1.Function "concat" [AST1.String "10", AST1.String "10"]]],
          AST1.Assign (AST1.Variable "theInt") (AST1.Integer 10),
          AST1.Assign (AST1.Variable "theString") (AST1.String "abcd"),
          AST1.Assign (AST1.Variable "theAddress") (AST1.Integer 0x1234),
--          Assign (EVariable var4) (EPlus (EInteger 12) (EInteger 73)),
          AST1.Assign (AST1.Variable "theSum") (AST1.Function "plus" [AST1.Integer 1, AST1.Integer 74]),
--          AST1.Assign (AST1.Variable "theFunctionEvaluation") (AST1.Function "inc" [AST1.Integer 1]),
--          Assign (EVariable var5) (EFunction $ AnyFunction $ Function ((\x y z -> return $ x + y + z)::Integer->Integer->Integer->IO Integer) [EInteger 1, EInteger 74, EInteger 10]),
          AST1.Assign (AST1.Variable "theFunctionEvaluation") (AST1.Function "length" [AST1.String "abcd"]),
--          Assign (EVariable var4) (EPlus (EInteger 12) (EString "abcd")),
--          Assign (EInteger 4) (EInteger 0x1234),

          AST1.ExpressionStatement $ AST1.Function "print" [AST1.Function "plus" [AST1.Integer 1, AST1.Integer 7]],
          AST1.ExpressionStatement $ AST1.Function "print" [AST1.Function "concat" [AST1.String "abcd", AST1.String "efgh"]],
          
          AST1.ExpressionStatement $ AST1.Function "print" [AST1.Variable "theInt"],
          AST1.ExpressionStatement $ AST1.Function "print" [AST1.Variable "theString"],
          AST1.ExpressionStatement $ AST1.Function "print" [AST1.Variable "theAddress"],
          AST1.ExpressionStatement $ AST1.Function "print" [AST1.Variable "theSum"],
          AST1.ExpressionStatement $ AST1.Function "print" [AST1.Variable "theFunctionEvaluation"]
--          Print (EFunction $ Function (\(x::Integer) -> x+1) [EInteger 1])
        ]
    
