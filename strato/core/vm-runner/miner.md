## Mining architecture

1. a trigger is set up for blocks without a nonce. it triggers `triggerThread` which

  a. writes the blockhash to STM
  
  b. blocks
  
2. we have `N` `minerThread`s that

  a. reads STM for new block
  
  b. mines until successful
  
  c. writes to DB (updates nonce)
  
  d. reads STM for new block...

![Architecture](http://i.imgur.com/s0d07O6.jpg)

## Miners

### Dummy
2b. is a gaussian proceess with mean around blocktime

### SHA
2b. solves SHA(something)=hash
