# STRATO Management Dashboard

The management dashboard can be accessed by accessing the machine on which the installation was performed on port 80. For [strato-getting-started](http://developers.blockapps.net/install/local/), this is the [localhost](http://localhost). SMD has plenty of features spread across several views.

## Dashboard

- At A Glance health check of your Blockchain
- View Peers to understand your network topology
- Metrics like Block Number, Difficulty, Users, and more
- Live Graphs to monitor network activity

![Health Check](http://i.imgur.com/kKEaOoc.gif)

- Recent Transactions

![Recent Transactions](http://i.imgur.com/GEu9ZGM.gif)

## Blocks

- A query builder that allows you to query your blockchain

![Query Blocks](http://i.imgur.com/c2rJicT.gif)

- Click on a row to see a comprehensive view of a block

![Block Details](http://i.imgur.com/pTvT1q2.gif)

## Transactions

- A query builder that allows you to query transactions on the blockchain
- Click on a row to see a comprehensive view of a transaction

## Accounts

- A table containing all accounts on your blockchain
- Click on a row to see a comprehensive view of an account

![Account Details](http://i.imgur.com/AUvv5FM.gif)

- A search function, to quickly get information on a specific account

![Search Accounts](http://i.imgur.com/QKSOpoE.gif)

- A form to send funds between accounts
1. Click Send Ether and Fill out the Form

![Send Funds 1](http://i.imgur.com/NI0L5SD.gif)

2. Submit and View the Results

![Send Funds 2](http://i.imgur.com/TficfFo.gif)

## Contracts

- View all contracts on the blockchain
- View the state of a specific contract, as well as previously uploaded versions of the same contract

![Contract State](http://i.imgur.com/IxRPaSX.gif)

- Upload contracts through a simple drag and drop, supplying constructor arguments as needed

1. Click Create Contract and Fill out the Form. Check the "Searchable" box if you want to be able to query the state of the contract using Cirrus. You will only have to upload a contract as "Searchable" once for all future instances of that contract to be indexed in Cirrus.

![Upload Contract 1](http://i.imgur.com/tSVtm4z.gif)

2. Drag and Drop the Contract (.sol file) to Upload

![Upload Contract 2](http://i.imgur.com/s2vB7v8.gif)

3. Provide Constructor Arguments (If there are any)
4. Upload!
5. Verify Upload

![Upload Contract 3](http://i.imgur.com/WgSLog1.gif)

- Query the contract using Cirrus
1. Click the Query Builder button on an *indexed* contract
2. Form your query using the query builder

- Call Methods on any contract

1. Click an Instance of A Contract (A row in the table)
2. Click Call Method, Fill Out the Form

![Call Contract Method 1](http://i.imgur.com/QdhdSkq.gif)

3. Submit and View Results

![Call Contract Method 2](http://i.imgur.com/30bhdEz.gif)
