{-# LANGUAGE DeriveDataTypeable     #-}
{-# LANGUAGE EmptyDataDecls         #-}
{-# LANGUAGE FlexibleContexts       #-}
{-# LANGUAGE FlexibleInstances      #-}
{-# LANGUAGE FunctionalDependencies #-}
{-# LANGUAGE GADTs                  #-}
{-# LANGUAGE MultiParamTypeClasses  #-}
{-# LANGUAGE OverloadedStrings      #-}
{-# LANGUAGE TypeFamilies           #-}
{-# LANGUAGE UndecidableInstances   #-}

module Handler.BlockInfo where


import           Handler.Common
import           Handler.Filters
import           Import

import qualified Database.Esqueleto as E

import           Data.List
import qualified Data.Map           as Map

import qualified Data.Text          as T
import qualified Prelude            as P

blockIdRef :: (E.Esqueleto query expr backend) =>(expr (Entity BlockDataRef), expr (Entity Block))-> expr (E.Value Bool)
blockIdRef (a, t) = (a E.^. BlockDataRefBlockId E.==. t E.^. BlockId)

getBlockInfoR :: Handler Value
getBlockInfoR = do
              getParameters <- reqGetParams <$> getRequest

              appNameMaybe <- lookupGetParam "appname"
              case appNameMaybe of
                (Just t)  -> liftIO $ putStrLn $ t
                (Nothing) -> liftIO $ putStrLn "anon"

              limit <- liftIO $ myFetchLimit

              sortParam <- lookupGetParam "sortby"

              let index'  = (fromIntegral $ (maybe 0 id $ extractPage "index" getParameters)  :: Integer)
              let raw    = (fromIntegral $ (maybe 0 id $ extractPage "raw" getParameters) :: Integer) > 0
              let paramMap = Map.fromList getParameters
                  paramMapRemoved = P.foldr (\param mp -> (Map.delete param mp)) paramMap blockQueryParams

              addHeader "Access-Control-Allow-Origin" "*"
              blks <- case ((paramMapRemoved == Map.empty) && (paramMap /= Map.empty)) of
                  False -> invalidArgs [T.concat ["Need one of: ", T.intercalate " , " $ blockQueryParams]]
                  True ->  runDB $ E.select $
                    E.from $ \(bdRef `E.InnerJoin` blk `E.LeftOuterJoin` btx `E.FullOuterJoin` rawTX `E.LeftOuterJoin` accStateRef) -> do

                    E.on ( accStateRef E.^. AddressStateRefAddress E.==. rawTX E.^. RawTransactionFromAddress )
                    E.on ( rawTX E.^. RawTransactionId E.==. btx E.^. BlockTransactionTransaction )
                    E.on ( btx E.^. BlockTransactionBlockId E.==. blk E.^. BlockId )
                    E.on ( blk E.^. BlockId E.==. bdRef E.^. BlockDataRefBlockId )

                    let criteria = P.map (getBlkFilter (bdRef, accStateRef, rawTX, blk)) $ getParameters
                    let allCriteria = ((bdRef E.^. BlockDataRefNumber) E.>=. E.val index') : criteria

                    E.where_ (P.foldl1 (E.&&.) allCriteria)

                    E.limit $ limit

                    -- E.orderBy [E.asc (bdRef E.^. BlockDataRefNumber)]
                    E.orderBy $ [(sortToOrderBy sortParam) $ (bdRef E.^. BlockDataRefNumber)]
                    return blk

              let modBlocks = (nub (P.map entityVal (blks :: [Entity Block])))
              let newindex = pack $ show $ 1+(getBlockNum $ P.last modBlocks)
              let extra p = P.zipWith extraFilter p (P.repeat (newindex))
              -- this should actually use URL encoding code from Yesod
              let next p = "/eth/v1.2/block?" P.++  (P.foldl1 (\a b -> (unpack a) P.++ "&" P.++ (unpack b)) $ P.map (\(k,v) -> (unpack k) P.++ "=" P.++ (unpack v)) (extra p))
              let addedParam = appendIndex getParameters

              toRet raw modBlocks (next addedParam) -- consider removing nub - it takes time n^{2}
            where
              toRet :: Bool -> [Block] -> String -> Handler Value
              toRet raw bs gp = case if' raw bs (P.map bToBPrime (P.zip (P.repeat gp) bs)) of
                      Left a  -> returnJson a
                      Right b -> returnJson b

