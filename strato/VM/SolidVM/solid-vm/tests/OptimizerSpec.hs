{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeSynonymInstances, FlexibleInstances, FlexibleContexts #-}
module OptimizerSpec where

import qualified Data.Map as M
import Data.Maybe            (catMaybes) 
import           Control.Lens
--import           Control.Monad (liftM2)
import qualified Data.Text as T
import           Data.Source.Annotation

import           Test.Hspec
import           Test.QuickCheck
import           Text.RawString.QQ

--import Blockchain.SolidVM.SM (MonadSM)
import           SolidVM.Model.CodeCollection
import           SolidVM.Model.SolidString
import           SolidVM.Model.Type as SVMType

--import  SolidVM.Model.Value

import           Blockchain.SolidVM.Exception
import           Blockchain.SolidVM.CodeCollectionDB
import           SolidVM.Solidity.StaticAnalysis.Optimizer       as O
import qualified SolidVM.Solidity.StaticAnalysis.Typechecker     as TP 

import BlockApps.Logging
import Blockchain.Strato.Model.Keccak256
--import qualified Blockchain.SolidVM                              as SolidVM
--import           Data.Source.Position 
-- --import           Blockchain.SolidVM.SM
-- import           Blockchain.Strato.Model.ExtendedWord (Word256)
--import qualified SolidVM.Model.Type                              as SVMType 
import Debug.Trace
import  SolidVM.Solidity.Parse.UnParser
import SolidVMSpec

import Test.QuickCheck.Monadic (assert, monadicIO, run) --pick, pre,
import Blockchain.VMContext
--------------------
--Helper Functions
--------------------





runOptimizer :: String -> CodeCollection
runOptimizer c = case compileSourceWithAnnotations True (M.fromList [("",T.pack c)]) of
            Left _ -> internalError "Compilation Error" ()
            Right cc -> cc

runTestOptimizer :: CodeCollection -> IO ()
runTestOptimizer f = case f of
    (CodeCollection _ _ _ _ _ _ _) -> return ()

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


getStringContracts :: [CodeCollection] -> [(String, String) ]
getStringContracts arrCC = do 
    let map2 = (map fst) $ (filter (([] == ) . snd)) $ (zip arrCC $ TP.detector <$> arrCC)
    let ls1  = (unparseContract <$>) $ catMaybes $ (M.lookup "qq") <$> (_contracts <$> map2)
    let ls2  =  (unparseContract <$>) $ catMaybes $ (M.lookup "qq") <$> (_contracts <$> (O.detector <$> map2))
    (zip ls1 ls2)


filterValidCodeCollections :: [CodeCollection] -> [CodeCollection]
filterValidCodeCollections arrCC = (map fst) $ (filter (([] == ) . snd)) $ zip arrCC $ TP.detector <$> arrCC


---------------------------------------
--Dummy Data
---------------------------------------


---------------------------------------------
--Functions related to size of CodeCollection
---------------------------------------------

storageDefSize :: VariableDecl -> Int
storageDefSize vd  = case  _varInitialVal vd of
        Nothing -> 0
        Just ex -> count ex
    where 
        count :: (Expression) -> Int
        count (Binary _ _ expr1 expr2 ) = (count expr1 ) + (count expr2)
        count _ = 1



-----------------------
--Property Based Tests
------------------------


propSameOrSmallerSize :: [CodeCollection] -> Bool
propSameOrSmallerSize arrCC = do 
    let map2 = filterValidCodeCollections arrCC

        storgeDefs1 = (_storageDefs <$>) $ catMaybes $ (M.lookup "qq") <$> (_contracts <$> map2) 
        storgeDefs2 = (_storageDefs <$>) $ catMaybes $ (M.lookup "qq") <$> (_contracts <$>  (O.detector <$> map2))
        
        listOf1VariableDeclF = (snd <$> (concat $ M.toList <$> storgeDefs1))
        listOf2VariableDeclF = (snd <$> (concat $ M.toList <$> storgeDefs2))
    (storageDefSize <$> listOf1VariableDeclF) <= (storageDefSize <$>   listOf2VariableDeclF) 


propSameValueAfterNOpts :: [CodeCollection] -> Bool
propSameValueAfterNOpts arrCC = do 
    let lsCC = O.detector <$> filterValidCodeCollections arrCC  
    let storgeDefsOptimizedOnce   = (_storageDefs <$>) $ catMaybes $ (M.lookup "qq") <$> (_contracts <$> lsCC)
    let storgeDefsDoubleOptimized = (_storageDefs <$>) $ catMaybes $ (M.lookup "qq") <$> (_contracts <$>  (O.detector <$> lsCC))
    storgeDefsOptimizedOnce == storgeDefsDoubleOptimized

propTest :: [CodeCollection] -> Bool
propTest arrCC = do 
    --Clean code up put in let block
    let map2 = (map fst) $ (filter (([] == ) . snd)) $ (zip arrCC $ TP.detector <$> arrCC)
    let len2 =  (O.detector <$> map2)
    let storgeDefs1 = (_storageDefs <$>) $ catMaybes $ (M.lookup "qq") <$> (_contracts <$> len2)
    let storgeDefs2 = (_storageDefs <$>) $ catMaybes $ (M.lookup "qq") <$> (_contracts <$>  (O.detector <$> len2))
    let storgeDefs3 = (_storageDefs <$>) $ catMaybes $ (M.lookup "qq") <$> (_contracts <$> map2)
    
    let listOf1VariableDeclF = (snd <$> (concat $ M.toList <$> storgeDefs1))
    let listOf2VariableDeclF = (snd <$> (concat $ M.toList <$> storgeDefs3))
    trace (show $ (unparseContract <$>) $ catMaybes $ (M.lookup "qq") <$> (_contracts <$> map2)) (storgeDefs2 ==  storgeDefs1) && ((storageDefSize <$> listOf1VariableDeclF) <= (storageDefSize <$>   listOf2VariableDeclF)) -- && ( vals1 == vals2 )
    --Prelude.length map2 == Prelude.length len2

propEvaluatesToTheSame :: [CodeCollection]  -> Property
propEvaluatesToTheSame arrCC = monadicIO $ do
  let last11 = last $ getStringContracts arrCC
  return $ runTest $ do 
    --let t1 = runTest'' $  
    (runBS $ snd last11)
    (runBS $ fst last11)
    res1 <- checkStorage
     
    res2 <- checkStorage
    return $ res2 == res1

prop_factor'' :: [CodeCollection]  -> Property
prop_factor'' arrCC = monadicIO $ do
  case arrCC of
    [] -> Test.QuickCheck.Monadic.assert $ True
    _ ->  do
          let last111 = last $ getStringContracts arrCC
          good <-  run $ runConte (do runBS  $ snd last111) (do runBS $ snd last111)
          Test.QuickCheck.Monadic.assert $ good
    --let t2 = (runTestContextM $ withCurrentBlockHash zeroHash res)
  --Test.QuickCheck.Monadic.assert $ res

--So My goal is to make a function of IO [(Key, ByteString)]



prop_writeThenRead :: Property
prop_writeThenRead = monadicIO $ do 
                                    good <-  run $ runConte (do
                                        runBS [r|
                                    pragma solidvm 3.3;
                                    contract qq {
                                      int a =3;
                                      }
                                    |]) (do
                                        runBS [r|
                                    pragma solidvm 3.3;
                                    contract qq {
                                      int a =3;
                                      }
                                    |])
                                    Test.QuickCheck.Monadic.assert $ good 

runValidContracts''' ::  ContextM Bool ->  ContextM Bool -> ContextM Bool
runValidContracts''' a1  a2=  do
  a1' <- a1
  a2' <- a2
  return $ a1' == a2' 

-- runConte :: ContextM a -> IO (a, ContextState)
-- runConte f =  runLoggingT (runTestContextM $ withCurrentBlockHash zeroHash f)

runConte :: ContextM a -> ContextM a  -> IO (Bool) --(a, ContextState)
runConte f b =  do
  (_, forSure) <-  runLoggingT (runTestContextM $ withCurrentBlockHash zeroHash f)
  (_, forSure2) <- runLoggingT (runTestContextM $ withCurrentBlockHash zeroHash b)
  pure $ trace ("\tMY PRINT" ++ ((show $ _memDBs forSure))) ( (show $ _memDBs forSure) == (show $ _memDBs forSure2)) --(printf "test case timed out after")
--This doesn't seem like a good check, what would be better?
--Maybe just run expression?
--Look into this?


---------------------
spec :: Spec
spec = describe "Optimizer tests" $ do
    fit "can replace binary expression with number literal for state variables" $
        let anns = (runOptimizer [r|
            contract A {
                int b = 2 + 2 + 2;
            }|])  in case (varDeclHelper'' $ varDeclHelper' anns) of
                [(NumberLiteral _ 6 _) ] -> True
                _ -> False
    fit "Variable  wrap --- then takes the wrap and turns it to." $
        let anns = runOptimizer [r|
            pragma solidvm 3.3;
            type Mytype is int;
            contract A {
                Mytype a = Mytype.wrap(2);
            }|]  in case (varDeclHelper'' $ varDeclHelper' anns) of
                [NumberLiteral _ 2 _] -> True
                _ -> False
    fit "Unwrap Variable by name of Variable " $
        let anns = runOptimizer [r|
            pragma solidvm 3.3;
            type Mytype is int;
            contract A {
                Mytype a = Mytype.wrap(2);
                int xxx = Mytype.unwrap(a);
            }|]  in case varDeclHelper'' $ varDeclHelper' anns of
                [NumberLiteral _ 2 _, (NumberLiteral _ 2 _) ] -> True
                _ -> False
    fit "can turn func arguements and values to user defined" $
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
    it "Should be the same after one optimization" $
            quickCheck propSameValueAfterNOpts
    it "Should have equal evaluated expressions after optimization" $
            quickCheck propEvaluatesToTheSame
    fit "Should be same or less size (_storageDefs)" $
            quickCheck propSameOrSmallerSize
