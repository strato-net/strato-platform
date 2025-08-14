- Found a new place in the frontend to update, http://localhost/dashboard > My Borrowing
- Currently there's a lot of BigInt conversion errors when deploying with the new LendingPool
```
ServerError: Cannot convert undefined to a BigInt (500)
TypeError: Cannot convert undefined to a BigInt
    at BigInt (<anonymous>)
    at toBig (/home/adnan/Documents/Lending_Protocol_Aug2025/strato-platform/mercata/backend/src/api/helpers/lending.helper.ts:3:55)
    at calculateAccruedInterest (/home/adnan/Documents/Lending_Protocol_Aug2025/strato-platform/mercata/backend/src/api/helpers/lending.helper.ts:37:12)
    at simulateLoan (/home/adnan/Documents/Lending_Protocol_Aug2025/strato-platform/mercata/backend/src/api/helpers/lending.helper.ts:152:69)
    at listLoansForLiquidation (/home/adnan/Documents/Lending_Protocol_Aug2025/strato-platform/mercata/backend/src/api/services/lending.service.ts:787:29)
    at processTicksAndRejections (node:internal/process/task_queues:95:5)
    at listNearUnhealthy (/home/adnan/Documents/Lending_Protocol_Aug2025/strato-platform/mercata/backend/src/api/controllers/lending.controller.ts:254:22)
```
- new version causes Available Borrowing Power to show 0 even though old version shows $286
- finding several other points to change in backend, leaving comments
