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

import qualified Data.Map           as Map

import qualified Data.Text          as T
import qualified Prelude            as P

import Blockchain.Data.Transaction

{-
blockIdRef :: (E.Esqueleto query expr backend) =>(expr (Entity BlockDataRef), expr (Entity Block))-> expr (E.Value Bool)
blockIdRef (a, t) = (a E.^. BlockDataRefBlockId E.==. t E.^. BlockId)
-}

getBlockInfoR :: Handler Value
getBlockInfoR = do
              getParameters <- reqGetParams <$> getRequest

              limit <- liftIO $ myFetchLimit

              sortParam <- lookupGetParam "sortby"

              let index'  = (fromIntegral $ (maybe 0 id $ extractPage "index" getParameters)  :: Integer)
              let paramMap = Map.fromList getParameters
                  paramMapRemoved = P.foldr (\param mp -> (Map.delete param mp)) paramMap blockQueryParams

              addHeader "Access-Control-Allow-Origin" "*"
              blks <- case ((paramMapRemoved == Map.empty) && (paramMap /= Map.empty)) of
                  False -> invalidArgs [T.concat ["Need one of: ", T.intercalate " , " $ blockQueryParams]]
                  True ->  runDB $ E.select $
                    E.from $ \(bdRef `E.LeftOuterJoin` btx `E.FullOuterJoin` rawTX `E.LeftOuterJoin` accStateRef) -> do

                    E.on ( accStateRef E.^. AddressStateRefAddress E.==. rawTX E.^. RawTransactionFromAddress )
                    E.on ( rawTX E.^. RawTransactionId E.==. btx E.^. BlockTransactionTransaction )
                    E.on ( btx E.^. BlockTransactionBlockDataRefId E.==. bdRef E.^. BlockDataRefId )

                    let criteria = P.map (getBlkFilter (bdRef, accStateRef, rawTX)) $ getParameters
                    let allCriteria = ((bdRef E.^. BlockDataRefNumber) E.>=. E.val index') : criteria

                    E.where_ (P.foldl1 (E.&&.) allCriteria)

                    E.limit $ limit

                    E.distinctOnOrderBy [(sortToOrderBy sortParam) $ (bdRef E.^. BlockDataRefNumber)] (return bdRef)


              let blockIds = P.map entityKey blks

              txs <- runDB $ E.select $ 
                     E.from $ \(btx `E.InnerJoin` rawTX) -> do
                       E.on ( rawTX E.^. RawTransactionId E.==. btx E.^. BlockTransactionTransaction )
                       E.where_ $ btx E.^. BlockTransactionBlockDataRefId `E.in_` E.valList blockIds
                       E.orderBy [E.asc (btx E.^. BlockTransactionId)]
                       return (btx, rawTX)

              let getTXLists = flip (Map.findWithDefault []) $
                               Map.fromListWith (flip (++)) $ map (fmap (:[])) $ P.map (\(x, y) -> (blockTransactionBlockDataRefId $ entityVal x, rawTX2TX $ entityVal y)) txs::(Key BlockDataRef->[Transaction]) 


              let modBlocks = P.map (\x -> (entityVal x, entityKey x)) (blks::[Entity BlockDataRef])
              let newindex = pack $ show $ 1+(blockDataRefNumber $ fst $ P.last modBlocks)
              let extra p = P.zipWith extraFilter p (P.repeat (newindex))
              -- this should actually use URL encoding code from Yesod
              let next p = "/eth/v1.2/block?" P.++  (P.foldl1 (\a b -> (unpack a) P.++ "&" P.++ (unpack b)) $ P.map (\(k,v) -> (unpack k) P.++ "=" P.++ (unpack v)) (extra p))
              let addedParam = appendIndex getParameters

              toRet (map (fmap getTXLists) modBlocks) (next addedParam)
            where
              toRet :: [(BlockDataRef, [Transaction])] -> String -> Handler Value
              toRet bs gp = returnJson . P.map (uncurry (bToBPrime gp)) $ bs
