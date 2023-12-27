{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module OptimizerSpec where

--pick, pre,

import BlockApps.Logging
import Blockchain.DB.CodeDB
import Blockchain.DB.MemAddressStateDB
import Blockchain.DB.SolidStorageDB
import Blockchain.Data.AddressStateDB
import Blockchain.SolidVM.CodeCollectionDB
import Blockchain.SolidVM.Exception
import Blockchain.Strato.Model.Keccak256
import Blockchain.VMContext
import Control.Lens
import qualified Control.Monad.Change.Alter as A
import Control.Monad.IO.Class
import Control.Monad.Trans.Class
import qualified Data.Map.Strict as M
import Data.Maybe (catMaybes)
import Data.Source.Annotation
import qualified Data.Text as T
import SolidVM.Model.CodeCollection
import SolidVM.Model.SolidString
import SolidVM.Model.Storable
import SolidVM.Model.Type as SVMType
import SolidVM.Solidity.Parse.UnParser
import SolidVM.Solidity.StaticAnalysis.Optimizer as O
import qualified SolidVM.Solidity.StaticAnalysis.Typechecker as TP
import SolidVMSpec
import Test.Hspec
import Test.QuickCheck
import Test.QuickCheck.Monadic (assert, monadicIO, run)
import Text.RawString.QQ

--------------------
--Helper Functions
--------------------

instance {-# OVERLAPPING #-} (Keccak256 `A.Alters` DBCode) m => (Keccak256 `A.Alters` DBCode) (MainChainT (MemAddressStateDB m)) where
  lookup p = lift . lift . A.lookup p
  insert p k = lift . lift . A.insert p k
  delete p = lift . lift . A.delete p

runOptimizer :: String -> IO CodeCollection
runOptimizer c = runNewMemCodeDB . runNewMemAddressStateDB . runMainChainT $ do
  eCC <- compileSourceWithAnnotations True (M.fromList [("", T.pack c)])
  case eCC of
    Left _ -> internalError "Compilation Error" ()
    Right cc -> pure cc

runTestOptimizer :: CodeCollection -> IO ()
runTestOptimizer f = case f of
  (CodeCollection _ _ _ _ _ _ _ _) -> return ()

varDeclHelper' :: CodeCollection -> [VariableDeclF (SourceAnnotation ())]
varDeclHelper' cc = cc ^.. contracts . folded . storageDefs . folded

varDeclHelper'' :: [VariableDeclF (SourceAnnotation ())] -> [ExpressionF (SourceAnnotation ())]
varDeclHelper'' varArr = (_varInitialVal <$> varArr) ^.. folded . folded

constDeclHelper :: CodeCollection -> [ConstantDeclF (SourceAnnotation ())]
constDeclHelper cc = cc ^.. contracts . folded . constants . folded

funcHelper :: CodeCollection -> [StatementF (SourceAnnotation ())]
funcHelper cc = (_funcContents <$> (cc ^.. contracts . folded . functions . folded)) ^.. folded . folded . folded

getFuncs :: CodeCollection -> [M.Map SolidVM.Model.SolidString.SolidString (FuncF (SourceAnnotation ()))] -- [FuncF (SourceAnnotation ())]
getFuncs cc = (cc ^.. contracts . folded . functions)

getFuncByName :: SolidString -> CodeCollection -> [FuncF (SourceAnnotation ())]
getFuncByName funName cc = case M.lookup funName $ head (getFuncs cc) of --replace head with a foreach function
  Just x -> [x]
  Nothing -> []

getStringContracts :: [CodeCollection] -> [(String, String)]
getStringContracts arrCC = do
  let map2 = filterValidCodeCollections arrCC
  let notOptimized = (unparseContract <$>) $ catMaybes $ (M.lookup "qq") <$> (_contracts <$> map2)
  let optimized = (unparseContract <$>) $ catMaybes $ (M.lookup "qq") <$> (_contracts <$> (O.detector <$> map2))
  zip notOptimized optimized

--Uses Typechecker to filter CocdeCollections that QuickCheck produces randomly
filterValidCodeCollections :: [CodeCollection] -> [CodeCollection]
filterValidCodeCollections arrCC = (map fst) $ (filter (([] ==) . snd)) $ zip arrCC $ TP.detector <$> arrCC

getAllVars :: ContextM [BasicValue]
getAllVars = (getAllSolidStorageKeyVals' uploadAddress) >>= (return . (\vals -> [y | (_, y) <- vals]))

evaluateContractsBatch :: [(String, String)] -> IO [Bool]
evaluateContractsBatch = sequence . map (\(x, y) -> getOutContextM $ comparteContracts x y)

contractToBasicValue :: String -> ContextM [BasicValue]
contractToBasicValue y = do
  runBS $ y
  getAllVars

comparteContracts :: String -> String -> ContextM Bool
comparteContracts contract1 contract2 = do
  res1 <- contractToBasicValue contract1
  res2 <- contractToBasicValue contract2
  return $ res2 == res1

getOutContextM :: ContextM Bool -> IO (Bool)
getOutContextM mB = do
  (a, _) <- runLoggingT (runTestContextM $ withCurrentBlockHash zeroHash mB)
  return a

---------------------------------------------
--Functions related to size of CodeCollection
---------------------------------------------

storageDefSize :: VariableDecl -> Int
storageDefSize vd = case _varInitialVal vd of
  Nothing -> 0
  Just ex -> count ex
  where
    count :: (Expression) -> Int
    count (Binary _ _ expr1 expr2) = (count expr1) + (count expr2)
    count _ = 1

-----------------------
--Property Based Tests
------------------------

propSameOrSmallerSize :: [CodeCollection] -> Bool
propSameOrSmallerSize arrCC = do
  let map2 = filterValidCodeCollections arrCC

      storgeDefsNotOptimized = (_storageDefs <$>) $ catMaybes $ (M.lookup "qq") <$> (_contracts <$> map2)
      storgeDefsOptimized = (_storageDefs <$>) $ catMaybes $ (M.lookup "qq") <$> (_contracts <$> (O.detector <$> map2))

      listOf1VariableDeclFNotOpt = (snd <$> (concat $ M.toList <$> storgeDefsNotOptimized))
      listOf2VariableDeclFOpt = (snd <$> (concat $ M.toList <$> storgeDefsOptimized))
  (sum $ storageDefSize <$> listOf1VariableDeclFNotOpt) >= (sum $ storageDefSize <$> listOf2VariableDeclFOpt)

propIdempotence :: [CodeCollection] -> Bool
propIdempotence arrCC = do
  let lsCC = O.detector <$> filterValidCodeCollections arrCC
  let storgeDefsOptimizedOnce = (_storageDefs <$>) $ catMaybes $ (M.lookup "qq") <$> (_contracts <$> lsCC)
  let storgeDefsDoubleOptimized = (_storageDefs <$>) $ catMaybes $ (M.lookup "qq") <$> (_contracts <$> (O.detector <$> lsCC))
  storgeDefsOptimizedOnce == storgeDefsDoubleOptimized

propEvaluatesToTheSame :: [CodeCollection] -> Property
propEvaluatesToTheSame arrCC = monadicIO $ do
  case arrCC of
    [] -> Test.QuickCheck.Monadic.assert $ True
    _ -> do
      res <- run $ ((return . (all id)) =<<) $ evaluateContractsBatch $ getStringContracts arrCC
      Test.QuickCheck.Monadic.assert $ res

--EXAMPLE
prop_example :: Property
prop_example = monadicIO $ do
  good <-
    run $
      getOutContextM $
        comparteContracts
          ( [r|
                                    contract qq {
                                      int a =3;
                                      }
                                    |]
          )
          ( [r|
                                    contract qq {
                                      int a =3;
                                      }
                                    |]
          )
  Test.QuickCheck.Monadic.assert $ good

---------------------
spec :: Spec
spec = describe "Optimizer tests" $ do
  it "can replace binary expression with number literal for state variables" $ do
    anns <-
      liftIO
        ( runOptimizer
            [r|
            contract A {
                int b = 2 + 2 + 2;
            }|]
        )
    ( case (varDeclHelper'' $ varDeclHelper' anns) of
        [(NumberLiteral _ 6 _)] -> True
        _ -> False
      )
      `shouldBe` True
  it "Variable  wrap --- then takes the wrap and turns it to." $ do
    anns <-
      liftIO $
        runOptimizer
          [r|
            type Mytype is int;
            contract A {
                Mytype a = Mytype.wrap(2);
            }|]
    ( case (varDeclHelper'' $ varDeclHelper' anns) of
        [NumberLiteral _ 2 _] -> True
        _ -> False
      )
      `shouldBe` True

  -- Temporarly removed untill further tests/research is done on optimizing variables by name
  -- it "Unwrap Variable by name of Variable " $
  --     let anns = runOptimizer [r|
  --         type Mytype is int;
  --         contract A {
  --             Mytype a = Mytype.wrap(2);
  --             int xxx = Mytype.unwrap(a);
  --         }|]  in case varDeclHelper'' $ varDeclHelper' anns of
  --             [NumberLiteral _ 2 _, (NumberLiteral _ 2 _) ] -> True
  --             _ -> False
  it "can turn func arguements and values to user defined" $ do
    anns <-
      liftIO $
        runOptimizer
          [r|
            type Mytype is int;
            contract A {
                Mytype a = Mytype.wrap(2);
                function f(Mytype y) returns (Mytype) { return (y);}
            }|]
    ( case concat $ (_funcArgs <$> getFuncByName "f" anns) ++ (_funcArgs <$> getFuncByName "f" anns) of
        [(Just _, (IndexedType 0 (SVMType.Int (Just True) Nothing))), (Just _, (IndexedType 0 (SVMType.Int (Just True) Nothing)))] -> True
        _ -> False
      )
      `shouldBe` True
  it "Should be the same after one optimization as two optimizes" $ --Cannot optimize an already optimized CodeCollection
    quickCheck propIdempotence
  it "Should have evaluated expressions between optimized and non-optimized CodeCollections equal" $
    quickCheck propEvaluatesToTheSame
  it "Should be same or less size (_storageDefs)" $
    quickCheck propSameOrSmallerSize
