
module Blockchain.Compiler where

--import Control.Monad
import Data.Map (Map)
import qualified Data.Map as Map


import qualified Blockchain.AST1 as AST1
import qualified Blockchain.AST1.Contract as AST1
import qualified Blockchain.AST1.FunctionDefinition as AST1
import qualified Blockchain.AST2 as AST2
import qualified Blockchain.AST2.Contract as AST2
import qualified Blockchain.AST2.FunctionDefinition as AST2
import Blockchain.Contract

compile1 :: Contract -> Map String AST2.Variable -> AST1.Contract -> AST2.Contract
compile1 c globals contract =
  let functions2 =
        (flip fmap) (AST1.functions contract) $ \f -> 
        AST2.FunctionDefinition $ (flip map) (AST1.code f) $ compileStatement1 c globals

  in AST2.Contract {
    AST2.name = AST1.name contract,
    AST2.functions = functions2
  }

compileStatement1 :: Contract -> Map String AST2.Variable -> AST1.Statement -> AST2.Statement
compileStatement1 c globals (AST1.Assign lexp1 rexp1) =
  let lexp2 = convert1 c globals lexp1
      rexp2 = convert1 c globals rexp1
  in AST2.Assign lexp2 rexp2
compileStatement1 c globals (AST1.ExpressionStatement exp1) =
  let exp2 = convert1 c globals exp1
  in AST2.ExpressionStatement exp2


convert1 :: Contract -> Map String AST2.Variable -> AST1.Expression -> AST2.Expression
convert1 _ globals (AST1.Variable name) = do
  case Map.lookup name globals of
    Nothing -> error $ "no variable of name: " ++ show name
    Just var -> AST2.EVariable var
convert1 _ _ (AST1.Integer i) = AST2.EInteger i
convert1 _ _ (AST1.String s) = AST2.EString s
convert1 c globals (AST1.Function name args1) =
  let args2 =
        (flip map) args1 $ \arg1 -> 
        convert1 c globals arg1
  in AST2.EFunction $ getNamedFunction c name args2
--convert1 _ x = error $ "missing case in convert1: " ++ show x


compileSingleLine :: AST2.Statement -> IO ()
compileSingleLine (AST2.Assign lExp rExp) = either (\err -> error $ "doggy2: " ++ show err) id $ AST2.assign lExp rExp
compileSingleLine (AST2.ExpressionStatement e) =
  let getter = either (\err -> error $ "doggy: " ++ show err) id $ AST2.getGetter e
  in do
    _ <- getter :: IO AST2.Value
    return ()

compile :: AST2.Contract -> Contract
compile contract =
  let functions' =
        (flip fmap) (AST2.functions contract) $ \f -> 
        AST2.Function (compileLines $ AST2.code f) [] :: AST2.Function (IO ())

  in Contract $ fmap AST2.AnyFunction functions'

compileLines :: [AST2.Statement] -> IO ()
compileLines [] = return ()
compileLines (x:rest) =
  let firstLine = compileSingleLine x
      remainingLines = compileLines rest
  in firstLine >> remainingLines


-----------------

getNamedFunction :: Contract -> String -> [AST2.Expression] -> AST2.AnyFunction
getNamedFunction _ "inc" args = AST2.AnyFunction $ AST2.Function incFunc args
getNamedFunction _ "plus" args = AST2.AnyFunction $ AST2.Function plusFunc args
getNamedFunction _ "length" args = AST2.AnyFunction $ AST2.Function lengthFunc args
getNamedFunction _ "concat" args = AST2.AnyFunction $ AST2.Function concatFunc args
getNamedFunction _ "print" args = AST2.AnyFunction $ AST2.Function printFunc args
getNamedFunction c name _ =
  case Map.lookup name $ functions c of
    Nothing -> error $ "Missing case in getNamedFunction: " ++ name
    Just x -> x

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
