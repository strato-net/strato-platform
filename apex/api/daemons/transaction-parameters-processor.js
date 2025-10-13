const { Kafka } = require('kafkajs');
const models = require('../models');
const logger = require('../lib/logger');

/**
 * Transaction Parameters Event Processor
 * 
 * Listens for TransactionSizeLimitChanged events from the TransactionParameters contract
 * and updates the NetworkParameters table in Postgres for API layer caching.
 * 
 * This processor ensures that the API layer has an up-to-date cache of the on-chain
 * transaction size limit.
 */

const TRANSACTION_PARAMETERS_ADDRESS = '0x0000000000000000000000000000000000001020';
const EVENT_NAME = 'TransactionSizeLimitChanged';

class TransactionParametersProcessor {
  constructor(config = {}) {
    this.kafkaHost = config.kafkaHost || process.env.KAFKA_HOST || 'kafka';
    this.kafkaPort = config.kafkaPort || process.env.KAFKA_PORT || '9092';
    this.groupId = config.groupId || 'transaction-parameters-processor';
    this.topic = config.topic || 'vmevents';
    
    this.kafka = new Kafka({
      clientId: this.groupId,
      brokers: [`${this.kafkaHost}:${this.kafkaPort}`],
      retry: {
        initialRetryTime: 100,
        retries: 8
      }
    });
    
    this.consumer = this.kafka.consumer({ groupId: this.groupId });
    this.running = false;
  }

  async start() {
    try {
      logger.info('Starting Transaction Parameters Event Processor...');
      
      await this.consumer.connect();
      await this.consumer.subscribe({ topic: this.topic, fromBeginning: false });
      
      this.running = true;
      
      await this.consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
          try {
            await this.processMessage(message);
          } catch (error) {
            logger.error('Error processing message:', error);
          }
        }
      });
      
      logger.info('Transaction Parameters Event Processor started successfully');
    } catch (error) {
      logger.error('Failed to start Transaction Parameters Event Processor:', error);
      throw error;
    }
  }

  async stop() {
    if (this.running) {
      logger.info('Stopping Transaction Parameters Event Processor...');
      this.running = false;
      await this.consumer.disconnect();
      logger.info('Transaction Parameters Event Processor stopped');
    }
  }

  async processMessage(message) {
    if (!message.value) return;
    
    try {
      const event = JSON.parse(message.value.toString());
      
      // Check if this is a VMEvent with Actions containing Events
      if (event.type === 'NewAction' && event.data && event.data._events) {
        for (const eventData of event.data._events) {
          await this.processEvent(eventData);
        }
      }
    } catch (error) {
      // Not JSON or not the format we're looking for, skip silently
      return;
    }
  }

  async processEvent(event) {
    // Check if this is a TransactionSizeLimitChanged event from TransactionParameters contract
    if (event.eventAddress && 
        event.eventAddress.toLowerCase() === TRANSACTION_PARAMETERS_ADDRESS.toLowerCase() &&
        event.eventName === EVENT_NAME) {
      
      logger.info(`Received ${EVENT_NAME} event from contract ${TRANSACTION_PARAMETERS_ADDRESS}`);
      
      try {
        // Parse event fields
        const eventFields = event.eventFields || [];
        const previousLimit = this.findField(eventFields, 'previousLimit');
        const newLimit = this.findField(eventFields, 'newLimit');
        const blockNumber = this.findField(eventFields, 'blockNumber');
        const timestamp = this.findField(eventFields, 'timestamp');
        
        if (newLimit === null) {
          logger.error('TransactionSizeLimitChanged event missing newLimit field');
          return;
        }
        
        logger.info(`Updating transaction size limit to ${newLimit} at block ${blockNumber}`);
        
        // Upsert to NetworkParameters table
        await models.NetworkParameter.upsert({
          parameterName: 'txSizeLimit',
          parameterValue: newLimit.toString(),
          blockNumber: blockNumber || 0,
          timestamp: timestamp || 0
        });
        
        logger.info(`Successfully updated NetworkParameters: txSizeLimit = ${newLimit}`);
        
      } catch (error) {
        logger.error('Error updating NetworkParameters table:', error);
      }
    }
  }

  findField(eventFields, fieldName) {
    const field = eventFields.find(f => f.name === fieldName);
    return field ? field.value : null;
  }
}

// If running as a standalone daemon
if (require.main === module) {
  const processor = new TransactionParametersProcessor();
  
  // Handle graceful shutdown
  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM signal');
    await processor.stop();
    process.exit(0);
  });
  
  process.on('SIGINT', async () => {
    logger.info('Received SIGINT signal');
    await processor.stop();
    process.exit(0);
  });
  
  // Start the processor
  processor.start().catch(error => {
    logger.error('Fatal error in Transaction Parameters Processor:', error);
    process.exit(1);
  });
}

module.exports = TransactionParametersProcessor;


