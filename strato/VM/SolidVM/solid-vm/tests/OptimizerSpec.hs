{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}
module OptimizerSpec where

import           Blockchain.SolidVM.CodeCollectionDB
import qualified Data.Map as M
import           Control.Lens

import qualified Data.Text as T

import           Test.Hspec
import           Text.RawString.QQ

import           SolidVM.Model.CodeCollection
import           Blockchain.SolidVM.Exception
import           Data.Source.Annotation

import Debug.Trace
--import           Text.Printf

-- Note that compileSourceWithAnnotations calls compileSource which calls the optimizer.detector
runOptimizer :: String -> CodeCollection
runOptimizer c = case compileSourceWithAnnotations True (M.fromList [("",T.pack c)]) of
            Left _ -> internalError "Compilation Error" ()
            Right cc -> cc

runTest :: CodeCollection -> IO ()
runTest f = case f of 
    (CodeCollection _ _ _ _ _ _) -> return ()
    
varDeclHelper :: CodeCollection -> [VariableDeclF (SourceAnnotation ())] 
varDeclHelper cc = cc  ^.. contracts . folded . storageDefs .folded

varDeclHelper' :: [VariableDeclF (SourceAnnotation ())] -> [ExpressionF (SourceAnnotation ())]
varDeclHelper' varArr = (varInitialVal <$>  varArr) ^.. folded . folded

constDeclHelper :: CodeCollection -> [ConstantDeclF (SourceAnnotation ())]
constDeclHelper cc = cc  ^.. contracts . folded . constants .folded

funcHelper :: CodeCollection -> [StatementF (SourceAnnotation ())]
funcHelper cc = (funcContents <$> (cc  ^.. contracts . folded . functions . folded) ) ^.. folded . folded .folded


spec :: Spec
spec = describe "Optimizer tests" $ do
    it "can replace binary expression with number literal for state variables" $
        let anns = (runOptimizer [r|
            contract A {
                int b = 2 + 2 + 2;
            }|])  in case (varDeclHelper' $ varDeclHelper anns) of 
                [(NumberLiteral _ 6 _) ] -> True
                _ -> False
    it "Variable  wrap --- then takes the wrap and turns it to." $
        let anns = trace (show (runOptimizer [r|
            pragma solidvm 3.3;
            type Mytype  is int;
            contract A {
                Mytype a = Mytype.wrap(2) ;
            }|]) ++ ("\n\n\t") ) 
                (runOptimizer [r|
            pragma solidvm 3.3;
            type Mytype is int;
            contract A {
                Mytype a = Mytype.wrap(2);
            }|])  in case (varDeclHelper' $ varDeclHelper anns) of 
                [(NumberLiteral _ 2 _)] -> True
                _ -> False
    it "Unwrap Variable by name of Variable " $
        let anns = trace (show (runOptimizer [r|
            pragma solidvm 3.3;
            type Mytype  is int;
            contract A {
                Mytype a = Mytype.wrap(2) ;
                int xxx = Mytype.unwrap(a);
            }|]) ++ ("\n\n\t") ) 
                (runOptimizer [r|
            pragma solidvm 3.3;
            type Mytype is int;
            contract A {
                Mytype a = Mytype.wrap(2);
                int xxx = Mytype.unwrap(a);
            }|])  in case (varDeclHelper' $ varDeclHelper anns) of 
                [(NumberLiteral _ 2 _), (NumberLiteral _ 2 _) ] -> True
                _ -> False
    fit "Test 2 " $
        let anns = trace (show (runOptimizer [r|
            pragma solidvm 3.3;
            type Mytype  is int;
            contract A {
                Mytype a = Mytype.wrap(2) ;
                function f(Mytype y) returns (Mytype) { return (y);}
            }|]) ++ ("\n\n\t") ) 
                (runOptimizer [r|
            pragma solidvm 3.3;
            type Mytype is int;
            contract A {
                Mytype a = Mytype.wrap(2);
                function f(Mytype y) returns (Mytype) { return (y);}
            }|])  in case (varDeclHelper' $ varDeclHelper anns) of 
                [(NumberLiteral _ 2 _) ] -> True
                _ -> False
    

-- VariableDecl {varType = UserDefined {alias = "Mytype", actual = Int {signed = Just True, bytes = Nothing}}, varIsPublic = False, varInitialVal = Nothing, varContext = (line 6, column 17) - (line 6, column 25): () , isImmutable = False})
    --TODO optimize simple statements....             
    -- fit "cannot simplify binary expressions in simple statements" $ 
    --     let anns =  (runOptimizer [r|
    --         contract A {
    --             function x() {int yy = 2 + 3;}
    --         }
    --     |]) in case funcHelper anns of
    --          [SimpleStatement (VariableDefinition _ _ ) _]-> True
    --          _ -> False