{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeSynonymInstances, FlexibleInstances, FlexibleContexts #-}
module OptimizerSpec where

import qualified Data.Map as M
import           Control.Lens
--import           Control.Monad (liftM2)
import qualified Data.Text as T
import           Data.Source.Annotation

import           Test.Hspec
import           Test.QuickCheck
import           Text.RawString.QQ


import           SolidVM.Model.CodeCollection
import           SolidVM.Model.SolidString
import           SolidVM.Model.Type as SVMType

import           Blockchain.SolidVM.Exception
import           Blockchain.SolidVM.CodeCollectionDB
--import           SolidVM.Solidity.StaticAnalysis.Optimizer       as O
--import qualified Blockchain.SolidVM                              as SolidVM
import           Data.Source.Position 
--import           Blockchain.SolidVM.SM

--import qualified SolidVM.Model.Type                              as SVMType 
--import Debug.Trace
--import           Text.Printf
data Colour = Red | Blue | Green
    deriving Show

instance Arbitrary Colour where
   arbitrary = oneof
      [return Red, return Blue, return Green]

-- emptyAnnotation :: SourceAnnotation T.Text
-- emptyAnnotation = (SourceAnnotation (initialPosition "") (initialPosition "") "")


dummyAnnotation :: SourceAnnotation ()
dummyAnnotation =
  SourceAnnotation
  {
    _sourceAnnotationStart=SourcePosition {
      _sourcePositionName="",
      _sourcePositionLine=0,
      _sourcePositionColumn=0
      },
    _sourceAnnotationEnd=SourcePosition {
      _sourcePositionName="",
        _sourcePositionLine=0,
        _sourcePositionColumn=0
      },
    _sourceAnnotationAnnotation = ()
  }


---I commented out so I get get working
--- THis will have to be redone for testing purposes
-- varDeclOptimizeredHelper :: MonadSM m => m Bool -> Bool
-- varDeclOptimizeredHelper m True = True
-- varDeclOptimizeredHelper _  = False

-- --Should check if size is smaller or atleast the same
-- --Should check if optimized twice it does differ from optimized once
-- --Should check that both unomptized and optimized expressions result in the same value
-- varDeclOptimizered :: [VariableDecl] -> Bool
-- varDeclOptimizered vd = varDeclOptimizeredHelper (liftM2 (==)
--         (head (map (\expr -> SolidVM.expToVar expr)  [ e | (VariableDecl  _ _ (Just e) _ _) <- vd ]))
--         (head (map (\expr -> SolidVM.expToVar expr)  [ e | (VariableDecl  _ _ (Just e) _ _) <- (O.varDeclHelper <$> vd) ])))
--             -- do
--             -- l1 <- (map (\expr -> SolidVM.expToVar expr)  [ e | (VariableDecl  _ _ (Just e) _ _) <- vd ]) 
--             -- l2 <- (map (\expr -> SolidVM.expToVar expr)  [ e | (VariableDecl  _ _ (Just e) _ _) <- (O.varDeclHelper <$> vd) ])
--             -- pure $ l1 == l2
--         --
        
--         --pure $ trace (" SHow some TExts\n\t" ++(show val1) )(O.varDeclHelper <$> (O.varDeclHelper <$> vd)) == (O.varDeclHelper <$> vd) -- Check idempotence 
         
        
    
    
    -- case liftM2 (==) (map (\expr -> SolidVM.expToVar expr)  [ e | (VariableDecl  _ _ (Just e) _ _) <- vd ])  (map (\expr -> SolidVM.expToVar expr)  [ e | (VariableDecl  _ _ (Just e) _ _) <- (O.varDeclHelper <$> vd) ]) of
    --     True -> True
    --     False -> False
    --     _ -> False



-- --hmm SO I have a list of VariableDecls. I want to run the expressions inside them?
--     (O.varDeclHelper <$> vd
    



-- instance Arbitrary (ExpressionF (SourceAnnotation T.Text)) where -- I think I can turn this signature into an a
--    arbitrary = oneof --Note I rather just us an Expression, not an ExpressionF(SourceAnnotation T.Text)
--       [return $ (NumberLiteral (emptyAnnotation) 2 Nothing), return $ (NumberLiteral (emptyAnnotation) 3 Nothing)]




-- instance Arbitrary VariableDecl where
--   arbitrary = VariableDecl <$> arbitrary
    
--     -- oneof --Note I rather just us an Expression, not an ExpressionF(SourceAnnotation T.Text)
    --   [return $ (NumberLiteral (dummyAnnotation) 3 Nothing)]


--Count of the size of an expression Tree
-- countExpr :: (ExpressionF a) -> Int
-- countExpr (Binary a _ (expr1) (expr2)) = (sum $ countExpr <$> [(expr1), (expr2)]) + 1 
-- countExpr (PlusPlus a (expr))          =   1 + countExpr (expr)
-- countExpr  (NumberLiteral _ _ _)     =  1
-- countExpr _ = 0
--   | MinusMinus a (ExpressionF a)
--   | NewExpression a Type
--   | IndexAccess a (ExpressionF a) (Maybe (ExpressionF a))
--   | MemberAccess a (ExpressionF a) SolidString -- ie
--   | FunctionCall a (ExpressionF a) (ArgListF a)
--   | Unitary a String (ExpressionF a)
--   | Ternary a (ExpressionF a) (ExpressionF a) (ExpressionF a)
--   | BoolLiteral a Bool
--   | StringLiteral a String
--   | TupleExpression a [Maybe (ExpressionF a)]
--   | ArrayExpression a [(ExpressionF a)]
--   | Variable a SolidString 
--   | ObjectLiteral a (Map.Map SolidString (ExpressionF a))
--   | HexaLiteral a SolidString -- if type clash remove ie hex"0F3A"



-- Trying to test a single fucntion
-- testOptimizeExpression :: [ Expression] -> Bool
-- testOptimizeExpression exprArr = do
--     optimizedArr  <- map (\x ->  (O.optimizeExpression x)  )  exprArr
--     let ls =  zip (map countExpr optimizedArr) (map countExpr exprArr)
--     return $ all (\(x, y) -> x <= y  ) ls




-- runOptimizerOnVarDecl' :: VariableDecl ->  VariableDecl
-- runOptimizerOnVarDecl' vd = O.varDeclHelper vd






-- Note that compileSourceWithAnnotations calls compileSource which calls the optimizer.detector
runOptimizer :: String -> CodeCollection
runOptimizer c = case compileSourceWithAnnotations True (M.fromList [("",T.pack c)]) of
            Left _ -> internalError "Compilation Error" ()
            Right cc -> cc

runTest :: CodeCollection -> IO ()
runTest f = case f of
    (CodeCollection _ _ _ _ _ _) -> return ()

varDeclHelper' :: CodeCollection -> [VariableDeclF (SourceAnnotation ())]
varDeclHelper' cc = cc  ^.. contracts . folded . storageDefs .folded

varDeclHelper'' :: [VariableDeclF (SourceAnnotation ())] -> [ExpressionF (SourceAnnotation ())]
varDeclHelper'' varArr = (_varInitialVal <$>  varArr) ^.. folded . folded

constDeclHelper :: CodeCollection -> [ConstantDeclF (SourceAnnotation ())]
constDeclHelper cc = cc  ^.. contracts . folded . constants .folded

funcHelper :: CodeCollection -> [StatementF (SourceAnnotation ())]
funcHelper cc = (_funcContents <$> (cc  ^.. contracts . folded . functions . folded) ) ^.. folded . folded .folded

getFuncs :: CodeCollection -> [M.Map SolidVM.Model.SolidString.SolidString (FuncF (SourceAnnotation ()))]-- [FuncF (SourceAnnotation ())]
getFuncs cc  = (cc  ^.. contracts . folded . functions )

getFuncByName :: SolidString -> CodeCollection  ->  [FuncF (SourceAnnotation ())]
getFuncByName funName cc = case M.lookup funName $ head  (getFuncs cc) of  --replace head with a foreach function 
                            Just x -> [x]
                            Nothing -> []

spec :: Spec
spec = describe "Optimizer tests" $ do
    it "can replace binary expression with number literal for state variables" $
        let anns = (runOptimizer [r|
            contract A {
                int b = 2 + 2 + 2;
            }|])  in case (varDeclHelper'' $ varDeclHelper' anns) of
                [(NumberLiteral _ 6 _) ] -> True
                _ -> False
    it "Variable  wrap --- then takes the wrap and turns it to." $
        let anns = runOptimizer [r|
            pragma solidvm 3.3;
            type Mytype is int;
            contract A {
                Mytype a = Mytype.wrap(2);
            }|]  in case (varDeclHelper'' $ varDeclHelper' anns) of
                [NumberLiteral _ 2 _] -> True
                _ -> False
    it "Unwrap Variable by name of Variable " $
        let anns = runOptimizer [r|
            pragma solidvm 3.3;
            type Mytype is int;
            contract A {
                Mytype a = Mytype.wrap(2);
                int xxx = Mytype.unwrap(a);
            }|]  in case varDeclHelper'' $ varDeclHelper' anns of
                [NumberLiteral _ 2 _, (NumberLiteral _ 2 _) ] -> True
                _ -> False
    it "can turn func arguements and values to user defined" $
        let anns = runOptimizer [r|
            pragma solidvm 3.3;
            type Mytype is int;
            contract A {
                Mytype a = Mytype.wrap(2);
                function f(Mytype y) returns (Mytype) { return (y);}
            }|] in case
             concat $ (_funcArgs <$> getFuncByName"f" anns) ++ (_funcArgs <$> getFuncByName"f" anns)
             of
                [(Just _, (IndexedType  0  ( SVMType.Int (Just True)  Nothing) ) ), (Just _, (IndexedType  0  ( SVMType.Int (Just True)  Nothing) ) )] -> True
                _ -> False

    -- fit "Something something" $
    --     quickCheck varDeclOptimizered
