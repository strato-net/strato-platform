# Payment Server (Stripe)

The payment server is created using ExpressJS. This version of the payment server uses the Stripe API for payments. It also features a lightweight SQL database (sqlite) to store customer addresses.

### Endpoints

#### Customer Endpoints

##### GET `/customer/address/:commonName`
Get all addresses associated with a customer's `commonName`.  
**Returns** a list of addresses in the `data` field of the response.

##### POST `/customer/address`
Adds an address using the following information from the JSON body:
```
{
  commonName: string,
  name: string,
  zipcode: string,
  state: string,
  city: string,
  addressLine1: string,
  addressLine2: string optional,
  country: string
}
```
**Returns** the `id` of the newly added address in the table.

##### GET `/customer/address/id/:id`
Gets an address given the table `id` of the address. 
**Returns** the address in the `data` field of the response.

##### DELETE `/customer/address/id/:id`
Deletes an address given the table `id` of the address.  
**Returns** the number of `changes` made after the deletion.

#### Stripe Endpoints

##### GET `/stripe/onboard/:accountId?`
Onboard a user, `accountId` optional.  
**Returns** the `connectLink` and the `accountDetails` if an `accountId` is not supplied. Else, return the `connectLink`.

##### GET `/stripe/status/:accountId`
Get the status of a stripe account given the `accountId` in the call URL.  
**Returns** the status of `chargesEnabled`, `detailsSubmitted`, and `payoutsEnabled` of the Stripe account.

##### POST `/stripe/checkout`
Create a checkout session given the following information from the order:
```
{
  cartData: list of cart items,
  orderDetail: list of order invoices,
  accountId: string
}
```
`cartData`, `orderDetail`, and `accountId` in a JSON body.  
**Returns** a new Stripe checkout session for the provided order.

##### GET `/stripe/session/:sessionId/:sellerId`
Get a stripe session given the `sessionId` and the `sellerId` in a JSON body.  
**Returns** the session information.

##### GET `/stripe/intent/:sessionId/:sellerId`
Get the stripe payment intent given the `sessionId` and the `sellerId` in a JSON body.  
**Returns** the payment intent information.

##### POST `/stripe/webhook`
TODO

##### POST `/stripe/webhook/connect`
TODO

### Dependencies

1. Docker Engine v24+ (For dockerized deployment)
2. Docker Compose V2
3. NodeJS 14+

*NOTE*  
Report and update dependencies if needed.

### Running

The server requires the following environmental variables to run:
```
`STRIPE_PUBLISHABLE_KEY` for Stripe API
`STRIPE_SECRET_KEY` for Stripe API
```

If running non-dockerized, use `npm run start` or `npm run dev`.  
If running dockerized, provide a `docker-compose.stripe-ps.yml` file and use `docker-compose -f docker-compose.stripe-ps.yml up -d --remove-orphans`.

