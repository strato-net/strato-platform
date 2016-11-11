# cirrus

## pre-requisites
1. `npm install -g pg pg-hstore`
2. `sequelize-auto -o "./models" -d sequelize_auto_test -h localhost -u my_username -p 5432 -x my_password -e postgres`

## running
1. `npm start`

## example queries

```graphql
{
   blocks (number: 100){
     number
     coinbase
   }
}
```
