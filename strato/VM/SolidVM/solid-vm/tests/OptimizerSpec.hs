{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeSynonymInstances, FlexibleInstances, FlexibleContexts #-}
module OptimizerSpec where

import           Control.Lens
import qualified Data.Map as M
import           Data.Maybe            (catMaybes) 
import qualified Data.Text as T
import           Data.Source.Annotation

import           Test.Hspec
import           Test.QuickCheck
import           Test.QuickCheck.Monadic (assert, monadicIO, run) --pick, pre,
import           Text.RawString.QQ

import           BlockApps.Logging
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.SolidVM.Exception
import           Blockchain.SolidVM.CodeCollectionDB
import           Blockchain.VMContext

import           SolidVM.Model.CodeCollection
import           SolidVM.Model.SolidString
import           SolidVM.Model.Type as SVMType
import           SolidVM.Solidity.StaticAnalysis.Optimizer       as O
import qualified SolidVM.Solidity.StaticAnalysis.Typechecker     as TP 
import           SolidVM.Solidity.Parse.UnParser

import           SolidVMSpec


--import Blockchain.SolidVM
import Blockchain.DB.SolidStorageDB
--import qualified Blockchain.Database.MerklePatricia          as MP
import SolidVM.Model.Storable

--import Debug.Trace



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
    let map2 = filterValidCodeCollections arrCC
    let ls1  = (unparseContract <$>) $ catMaybes $ (M.lookup "qq") <$> (_contracts <$> map2)
    let ls2  = (unparseContract <$>) $ catMaybes $ (M.lookup "qq") <$> (_contracts <$> (O.detector <$> map2))
    (zip ls1 ls2)


filterValidCodeCollections :: [CodeCollection] -> [CodeCollection]
filterValidCodeCollections arrCC = (map fst) $ (filter (([] == ) . snd)) $ zip arrCC $ TP.detector <$> arrCC


runValidContracts''' ::  ContextM Bool ->  ContextM Bool -> ContextM Bool
runValidContracts''' a1  a2=  do
  a1' <- a1
  a2' <- a2
  return $ a1' == a2' 

getAllVars ::  ContextM [BasicValue] --ContextM [(MP.Key, BasicValue)]
getAllVars = do 
    vals <- getAllSolidStorageKeyVals' uploadAddress 
    return [ y |(_, y)<- vals]


runConte :: ContextM a -> ContextM a  -> IO (Bool) --(a, ContextState)
runConte f b =  do
  (_, forSure) <-  runLoggingT (runTestContextM $ withCurrentBlockHash zeroHash f)
  (_, forSure2) <- runLoggingT (runTestContextM $ withCurrentBlockHash zeroHash b)
  --pure $ trace ("\tMY PRINT" ++ ((show $ _memDBs forSure))) ( (show $ _memDBs forSure) == (show $ _memDBs forSure2))
  pure $ (show $ _memDBs forSure) == (show $ _memDBs forSure2) 



evaluateContractsBatch :: [(String, String)] ->  IO [Bool]
evaluateContractsBatch  = sequence . map (\(x, y) -> runConte (contractToBasicValue x) (contractToBasicValue y))


contractToBasicValue :: String -> ContextM [BasicValue]
contractToBasicValue y = do 
    runBS  $ y
    getAllVars


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

propEvaluatesToTheSame :: [CodeCollection]  -> Property
propEvaluatesToTheSame arrCC = monadicIO $ do
  let last11 = last $ getStringContracts arrCC
  return $ runTest $ do 
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



-- propEvaluatesToTheSame' :: [CodeCollection]  -> Property
-- propEvaluatesToTheSame' arrCC = monadicIO $ do
--     case arrCC of
--         [] -> Test.QuickCheck.Monadic.assert $ True
--         _ -> do
--             let lsStrings = getStringContracts arrCC
--             let f  = sequence $ map  (\y ->  return $ runTest $ do 
--                             (runBS $ snd y)
--                             res1 <- getAllVars
--                             (runBS $ fst y)
--                             res2 <- getAllVars
--                             return $ res2 == res1) lsStrings
--             ls <-f
--             Test.QuickCheck.Monadic.assert  $ all id f

-- stringLS :: [(String, String)] -> IO [Bool]

propEvaluatesToTheSame' :: [CodeCollection]  -> Property
propEvaluatesToTheSame' arrCC = monadicIO $ do
  case arrCC of
    [] -> Test.QuickCheck.Monadic.assert $ True
    _ ->  do
          res <-  run $ ((return . (all id)) =<<) $ evaluateContractsBatch $ getStringContracts arrCC
          Test.QuickCheck.Monadic.assert $ res

    
--EXAMPLE
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


---------------------
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
    fit "Should be the same after one optimization" $
            quickCheck propSameValueAfterNOpts
    fit "Should have equal evaluated expressions after optimization" $
            quickCheck propEvaluatesToTheSame
    fit "Should be same or less size (_storageDefs)" $
            quickCheck propSameOrSmallerSize
    fit "REAL version of should be same value" $
            quickCheck propEvaluatesToTheSame'
