- we update state only at specific times, but what if a user is just coming into the app? the preview view functions give you a realtime view of their debt, even though the state is not updated.
- when you go to borrow, in the currently borrowed, plug in the full amount

We talked about Currently Borrowed (we should change the name of that anyways) and use getUserDebt

Available to Borrow is still same formula; based on the collateral and subtracts currentyl biorroweed. so stick to that, once you fix currently borrowed that sohould work

Current Health Factor see what that's doing, get back to maya
New Health Factor probably needs some change

Your Position --> Interest Owed (just put zero for now)
--> Total Borrowed should be total amount owed (also rn is it principal or total)

Repay:
- Principal Balance and Accrued Interest will break
- Total Amount Due will stay, with simplified

Change 3 to (borrow, repay, position)to Total Amount Owed
Don't remove anything, just set to zero and leave comment

Also internally there will be things that are being done to pass to contract

Liquidity Pools
- Look at each of the Pool Stats, see what each of them mean, and mostly they will not change. Look at Supply APY and Max Supply APY currently


