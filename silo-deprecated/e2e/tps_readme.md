## TPS batch test

### Note you will need a local `bloc` instance running for this test.

You will have to have a `132922485_transaction-batching` version of `strato-api` running. Make sure you set the profile matching your installation.

## Instructions

1. Download and install [`bloc#132922485_transaction-batching`](https://github.com/blockapps/bloc/tree/132922485_transaction-batching)
2. run `bloc init <projectname>` and note the directory of `<projectname>`. Point `bloc` to your strato node.
3. `cd projectname`
4. `bloc start`

In a separate terminal:

3. In the `config.yaml` file, edit the `blocUserFolder` field to point to `<projectname>`. Also point your test to your strato node.
4. `npm install`
5. `./node_modules/mocha/bin/mocha e2e/tps-batching.test.js`
