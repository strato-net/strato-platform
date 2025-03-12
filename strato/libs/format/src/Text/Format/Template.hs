
{-# OPTIONS -fno-warn-incomplete-patterns #-}
{-# OPTIONS -fno-warn-unused-matches #-}
{-# OPTIONS -fno-warn-name-shadowing #-}

module Text.Format.Template where

import Data.Maybe
import Language.Haskell.TH
import Language.Haskell.TH.Syntax

import Text.Tools

deriveFormat :: Name -> Q [Dec]
deriveFormat typName = do
  (TyConI d) <- reify typName -- Get all the information on the type
  (type_name,_,_,constructors) <- typeInfo (return d) -- extract name and constructors
  
  let getFields c = map show $ catMaybes $ (map fst . snd) c
      getName (Name (OccName theName) _) = theName
      theFunction' = funD (mkName "format") $ map (\c -> theClause (getName $ fst c) $ getFields c) constructors 
      
  x <-instanceD (cxt []) (appT (conT (mkName "Format")) (conT typName)) [theFunction']
  return [x]

combineWithPossibleTab :: String -> String -> String
combineWithPossibleTab left right =
  if '\n' `elem` right
  then left ++ "\n" ++ tab right
  else left ++ right

concatWithPossibleTab :: [String] -> String
concatWithPossibleTab = foldl1 combineWithPossibleTab

theClause :: Quote m => String -> [String] -> m Clause
theClause theName fields = clause [(conP (mkName theName) (map (varP . mkName . (++ "'")) fields))] (normalB $ f theName fields ) []

f :: Quote m => String -> [String] -> m Exp
f theName fields =
  appE (varE $ mkName "unlines") $ listE $ litE (StringL theName):(map (\x -> appE (varE $ mkName "concatWithPossibleTab") $ listE $ [litE $ StringL "  ", litE $ StringL x, litE $ StringL ": ", appE (varE $ mkName "format") $ varE $ mkName $ (++ "'") x]) fields)

typeInfo :: DecQ -> Q (Name, [Name], [(Name, Int)], [(Name, [(Maybe Name, Type)])])
typeInfo m =
  do d <- m
     case d of
       d@(DataD _ _ _ _ _ _) ->
         return $ (simpleName $ name d, paramsA d, consA d, termsA d)
       d@(NewtypeD _ _ _ _ _ _) ->
         return $ (simpleName $ name d, paramsA d, consA d, termsA d)
       _ -> error ("derive: not a data type declaration: " ++ show d)

     where
        consA (DataD _ _ _ _ cs _)    = map conA cs
        consA (NewtypeD _ _ _ _ c _)  = [ conA c ]

        {- This part no longer works on 7.6.3
        paramsA (DataD _ _ ps _ _) = ps
        paramsA (NewtypeD _ _ ps _ _) = ps
        -}

        -- Use this on more recent GHC rather than the above
        paramsA (DataD _ _ ps _ _ _) = map nameFromTyVar ps
        paramsA (NewtypeD _ _ ps _ _ _) = map nameFromTyVar ps

        nameFromTyVar (PlainTV a _) = a
        nameFromTyVar (KindedTV a _ _) = a


        termsA (DataD _ _ _ _ cs _) = map termA cs
        termsA (NewtypeD _ _ _ _ c _) = [ termA c ]

        termA (NormalC c xs)        = (c, map (\x -> (Nothing, snd x)) xs)
        termA (RecC c xs)           = (c, map (\(n, _, t) -> (Just $ simpleName n, t)) xs)
        termA (InfixC t1 c t2)      = (c, [(Nothing, snd t1), (Nothing, snd t2)])

        conA (NormalC c xs)         = (simpleName c, length xs)
        conA (RecC c xs)            = (simpleName c, length xs)
        conA (InfixC _ c _)         = (simpleName c, 2)

        name (DataD _ n _ _ _ _)      = n
        name (NewtypeD _ n _ _ _ _)   = n
        name d                      = error $ show d

simpleName :: Name -> Name
simpleName nm =
  let s = nameBase nm
  in case dropWhile (/=':') s of
       []          -> mkName s
       _:[]        -> mkName s
       _:t         -> mkName t

