import { assert, rest } from 'blockapps-rest'
import { util } from '/blockapps-rest-plus'
import dotenv from 'dotenv'
import config from '../../load.config'
import constants from '/helpers/constants'
import oauthHelper from '/helpers/oauthHelper'
import { get, post, put } from '/helpers/rest'
import RestStatus from 'http-status-codes';


import { productArgs } from './factories/product'
import { inventoryArgs } from './factories/inventory'
import { eventTypeArgs } from './factories/eventType'
import { eventArgs, certifyEventArgs } from './factories/event'
import { Product, Inventory, EventType, Event, Organizations } from '../../api/v1/endpoints'

const options = { config }

const loadEnv = dotenv.config()
assert.isUndefined(loadEnv.error)

describe('Event End-To-End Tests', function () {
  this.timeout(config.timeout)
  let admin
  let certifier;
  let certifierAddress;

  before(async () => {
    let adminToken
    let certifierToken
    try {
      adminToken = await oauthHelper.getUserToken(
        `${process.env.GLOBAL_ADMIN_NAME}`,
        `${process.env.GLOBAL_ADMIN_PASSWORD}`,
      )
      certifierToken = await oauthHelper.getUserToken(
        `${process.env.CERTIFIER_NAME}`,
        `${process.env.CERTIFIER_PASSWORD}`,
      )
    } catch (e) {
      console.error(
        'ERROR: Unable to fetch the org user token, check your OAuth settings in config',
        e,
      )
      throw e
    }

    const adminCredentials = { token: adminToken }
    const certifierCredentials = { token: certifierToken }

    const adminResponse = await oauthHelper.getStratoUserFromToken(adminCredentials.token)
    console.log("adminResponse", adminResponse)

    const certifierResponse = await oauthHelper.getStratoUserFromToken(certifierCredentials.token)
    console.log("certifierResponse", certifierResponse)

    assert.strictEqual(
      adminResponse.status,
      RestStatus.OK,
      adminResponse.message
    )
    admin = { ...adminResponse.user, ...adminCredentials }

    assert.strictEqual(
      certifierResponse.status,
      RestStatus.OK,
      certifierResponse.message
    )
    certifier = { ...certifierResponse.user, ...certifierCredentials }
    certifierAddress = certifier.address;
  })

  it('Create an Event', async () => {
    // create product
    const createProductArgs = {
      ...productArgs(util.uid()),
    }

    const createProductResponse = await post(
      Product.prefix,
      Product.create,
      createProductArgs,
      admin.token
    )

    assert.equal(createProductResponse.status, 200, 'should be 200');
    assert.isDefined(createProductResponse.body, 'body should be defined');

    const productAddress = createProductResponse.body.data[1]

    // create inventory
    const createInventoryArgs = {
      ...inventoryArgs(productAddress, util.uid()),
    }

    const createInventoryResponse = await post(
      Inventory.prefix,
      Inventory.create,
      createInventoryArgs,
      admin.token,
    )

    const serialNumbers = createInventoryArgs.serialNumber
    const serialNumbersArray = serialNumbers.map(serialNumber => serialNumber.itemSerialNumber)

    assert.equal(createInventoryResponse.status, 200, 'should be 200');
    assert.isDefined(createInventoryResponse.body, 'body should be defined')
    assert.isDefined(createInventoryResponse.body.data, 'body.data should be defined')

    // create eventType
    const createEventTypeArgs = {
      ...eventTypeArgs(util.uid()),
    }

    const createEventTypeResponse = await post(
      EventType.prefix,
      EventType.create,
      createEventTypeArgs,
      admin.token,
    )

    assert.equal(createEventTypeResponse.status, 200, 'should be 200');
    assert.isDefined(createEventTypeResponse.body, 'body should be defined')

    const eventTypeAddress = createEventTypeResponse.body.data[1]

    // create event
    const createEventArgs = {
      ...eventArgs(eventTypeAddress, certifierAddress, productAddress, util.uid(), serialNumbersArray),
    }

    const createEventResponse = await post(
      Event.prefix,
      Event.create,
      createEventArgs,
      admin.token,
    )

    assert.equal(createEventResponse.status, 200, 'should be 200');
    assert.isDefined(createEventResponse.body, 'body should be defined')
    assert.equal(createEventResponse.status, 200, 'should be 200');
    assert.equal(createEventArgs.serialNumbers.length, createEventResponse.body.data[1].split(",").length)
  })

  it('Get all Events', async () => {
    // get
    const getEvents = await get(
      Event.prefix,
      Event.getAll,
      {},
      admin.token,
    )

    assert.equal(getEvents.status, 200, 'should be 200');
    assert.isDefined(getEvents.body, 'body should be defined');
    assert.isDefined(getEvents.body.data, 'body should be defined');
  })

  it('Get all events by certifier', async () => {
    // get
    const getEvents = await get(
      Event.prefix,
      Event.getEventsByCertifier,
      {},
      certifier.token,
    )

    assert.equal(getEvents.status, 200, 'should be 200');
    assert.isDefined(getEvents.body, 'body should be defined');
    assert.isDefined(getEvents.body.data, 'body should be defined');
  })

  it('Should not get events for a non assigned certifier', async () => {
    // get
    const getEvents = await get(
      Event.prefix,
      Event.getEventsByCertifier,
      {},
      admin.token,
    )

    assert.equal(getEvents.status, 200, 'should be 200');
    assert.isDefined(getEvents.body, 'body should be defined');
    assert.equal(getEvents.body.data.message, 'User should be a Assigned certifier');
  })

  it('certify an Event', async () => {
    // create product
    const createProductArgs = {
      ...productArgs(util.uid()),
    }

    const createProductResponse = await post(
      Product.prefix,
      Product.create,
      createProductArgs,
      admin.token
    )

    assert.equal(createProductResponse.status, 200, 'should be 200');
    assert.isDefined(createProductResponse.body, 'body should be defined');

    const productAddress = createProductResponse.body.data[1]

    // create inventory
    const createInventoryArgs = {
      ...inventoryArgs(productAddress, util.uid()),
    }

    const createInventoryResponse = await post(
      Inventory.prefix,
      Inventory.create,
      createInventoryArgs,
      admin.token,
    )

    const serialNumbers = createInventoryArgs.serialNumber
    const serialNumbersArray = serialNumbers.map(serialNumber => serialNumber.itemSerialNumber)

    assert.equal(createInventoryResponse.status, 200, 'should be 200');
    assert.isDefined(createInventoryResponse.body, 'body should be defined')
    assert.isDefined(createInventoryResponse.body.data, 'body.data should be defined')

    // create eventType
    const createEventTypeArgs = {
      ...eventTypeArgs(util.uid()),
    }

    const createEventTypeResponse = await post(
      EventType.prefix,
      EventType.create,
      createEventTypeArgs,
      admin.token,
    )

    assert.equal(createEventTypeResponse.status, 200, 'should be 200');
    assert.isDefined(createEventTypeResponse.body, 'body should be defined')

    const eventTypeAddress = createEventTypeResponse.body.data[1]

    // create event
    const createEventArgs = {
      ...eventArgs(eventTypeAddress, certifierAddress, productAddress, util.uid(), serialNumbersArray),
    }

    const createEventResponse = await post(
      Event.prefix,
      Event.create,
      createEventArgs,
      admin.token,
    )

    assert.equal(createEventResponse.status, 200, 'should be 200');
    assert.isDefined(createEventResponse.body, 'body should be defined')
    assert.equal(createEventResponse.status, 200, 'should be 200');
    assert.equal(createEventArgs.serialNumbers.length, createEventResponse.body.data[1].split(",").length)

    //  get
    const getEvents = await get(
      Event.prefix,
      Event.getEventsByCertifier,
      {},
      certifier.token,
    )

    assert.equal(getEvents.status, 200, 'should be 200');
    assert.isDefined(getEvents.body, 'body should be defined');
    assert.isDefined(getEvents.body.data, 'body should be defined');

    const eventBatchId = getEvents.body.data.map(event => event.eventBatchId);

    // certify event
    const certifyEventsArgs = {
      ...certifyEventArgs(eventBatchId, util.uid()),
    }

    const certifyEvents = await put(
      Event.prefix,
      Event.certifyEvent,
      certifyEventsArgs,
      certifier.token,
    )

    assert.equal(certifyEvents.status, 200, 'should be 200');
    assert.isDefined(certifyEvents.body, 'body should be defined');
    assert.equal(certifyEvents.body.data[1], 'event has been certified');

  })

  it('Should not create events for incorrect serial numbers.', async () => {
    // create product
    const createProductArgs = {
      ...productArgs(util.uid()),
    }

    const createProductResponse = await post(
      Product.prefix,
      Product.create,
      createProductArgs,
      admin.token
    )

    assert.equal(createProductResponse.status, 200, 'should be 200');
    assert.isDefined(createProductResponse.body, 'body should be defined');

    const productAddress = createProductResponse.body.data[1]

    // create inventory
    const createInventoryArgs = {
      ...inventoryArgs(productAddress, util.uid()),
    }

    const createInventoryResponse = await post(
      Inventory.prefix,
      Inventory.create,
      createInventoryArgs,
      admin.token,
    )

    const serialNumbers = createInventoryArgs.serialNumber
    const serialNumbersArray = serialNumbers.map(serialNumber => serialNumber.itemSerialNumber)


    assert.equal(createInventoryResponse.status, 200, 'should be 200');
    assert.isDefined(createInventoryResponse.body, 'body should be defined')
    assert.isDefined(createInventoryResponse.body.data, 'body.data should be defined')

    // create eventType
    const createEventTypeArgs = {
      ...eventTypeArgs(util.uid()),
    }

    const createEventTypeResponse = await post(
      EventType.prefix,
      EventType.create,
      createEventTypeArgs,
      admin.token,
    )

    assert.equal(createEventTypeResponse.status, 200, 'should be 200');
    assert.isDefined(createEventTypeResponse.body, 'body should be defined')

    const eventTypeAddress = createEventTypeResponse.body.data[1]

    const serialNumbersSubset = serialNumbersArray.slice(0, serialNumbersArray.length / 2);
    serialNumbersSubset.push("8311371")

    // create event
    const createEventArgs = {
      ...eventArgs(eventTypeAddress, certifierAddress, productAddress, util.uid(), serialNumbersSubset),
    }

    const createEventResponse = await post(
      Event.prefix,
      Event.create,
      createEventArgs,
      admin.token,
    )

    assert.restStatus(createEventResponse.status, RestStatus.CONFLICT)
    assert.isDefined(createEventResponse.body, 'body should be defined')
  })
})
