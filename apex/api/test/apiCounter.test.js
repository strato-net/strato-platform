/* Unused code notice. Api counter disabled, to be deprecated  #api-counter-deprecation

slash-astrisk jshint esnext: true asterisk-slash
const assert = require('chai').assert;
const models = require('../models');
const { ApiCallCounter } = require('../controllers/apiCounter');


process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const timeout = 15 * 1000;

describe('Tests - Api Calls Counter', async function () {
  this.timeout(timeout);
  const counter = new ApiCallCounter()
  
  it('Counter can increment and reset properly', async function () {
    counter.resetCounters()
    counter.incrementReads()
    assert.equal(counter.reads, 1, 'reads is expected to be 1 after first increment')
    counter.incrementWrites()
    assert.equal(counter.writes, 1, 'writes is expected to be 1 after first increment')
    counter.incrementWrites()
    assert.equal(counter.writes, 2, 'writes is expected to be 2 after second increment')
    assert.equal(counter.reads, 1, 'reads is still expected to be 1 after writes were incremented')
    counter.incrementReads()
    assert.equal(counter.reads, 2, 'reads is expected to be 2 after second increment')
    counter.resetCounters()
    assert.equal(counter.reads, 0, 'reads is expected to be 0 after reset')
    assert.equal(counter.writes, 0, 'writes is expected to be 0 after reset')
  })


  it('Counter can save to DB properly', async function () {
    
    async function getApiStatData() {
      let [apiReadsCalculated, apiWritesCalculated, lastApiCallData] = await Promise.all([
        models.ApiCallCount.sum('apiReads', {}),
        models.ApiCallCount.sum('apiWrites', {}),
        models.ApiCallCount.findOne({
          order: [['createdAt', 'DESC']],
        })
      ])
      apiReadsCalculated = apiReadsCalculated || 0
      apiWritesCalculated = apiWritesCalculated || 0
      return {
        apiReadsCalculated,
        apiWritesCalculated,
        lastApiCallData
      }
    }

    counter.resetCounters()
    counter.incrementReads()
    counter.incrementReads()
    counter.incrementWrites()
    counter.incrementWrites()
    counter.incrementWrites()
    
    const statData1 = await getApiStatData()
    await counter.saveToDbAndReset()
    
    assert.equal(counter.reads, 0, 'reads is expected to be 0 after reset')
    assert.equal(counter.writes, 0, 'writes is expected to be 0 after reset')
    const statData2 = await getApiStatData()
    
    assert.equal(statData1.apiReadsCalculated, statData2.apiReadsCalculated - 2, 'expected to have exactly 2 api reads added since last record (statData1)')
    assert.equal(statData1.apiWritesCalculated, statData2.apiWritesCalculated - 3, 'expected to have exactly 3 api writes added since last record (statData1)')
    
    assert.equal(statData2.lastApiCallData.apiReads, 2, 'last record in db is expected to have 2 reads')
    assert.equal(statData2.lastApiCallData.apiWrites, 3, 'last record in db is expected to have 3 writes')

    const totalReadsWas = statData1.lastApiCallData ? statData1.lastApiCallData.apiReadsTotal : 0
    const totalWritesWas = statData1.lastApiCallData ? statData1.lastApiCallData.apiWritesTotal : 0
    
    assert.equal(totalReadsWas, statData2.lastApiCallData.apiReadsTotal - 2, 'total number of reads in db was expected to increase by 2')
    assert.equal(totalWritesWas, statData2.lastApiCallData.apiWritesTotal - 3, 'total number of writes in db was expected to increase by 3')

    counter.incrementReads()
    counter.incrementWrites()
    await counter.saveToDbAndReset()
    const statData3 = await getApiStatData()
    assert.equal(statData2.apiReadsCalculated, statData3.apiReadsCalculated - 1, 'expected to have exactly 1 new api reads added since last record (statData2)')
    assert.equal(statData2.apiWritesCalculated, statData3.apiWritesCalculated - 1, 'expected to have exactly 1 new api write added since last record (statData2)')
  })
  
})
*/
