{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeApplications  #-}
{-# LANGUAGE TypeFamilies      #-}
{-# LANGUAGE TypeOperators     #-}

module Server where 

import Servant
import API
import Blockchain.Data.Address
import Blockchain.Blockstanbul.Messages (InEvent(NewBeneficiary))

admin :: Server AdminAPI 
admin = createVote

createVote :: Address -> Bool -> Handler InEvent
createVote addr for_against = return $ NewBeneficiary addr for_against
