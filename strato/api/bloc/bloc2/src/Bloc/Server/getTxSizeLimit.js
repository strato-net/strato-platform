async function getTxSizeLimit(cachedLimit) {
  if (cachedLimit && cachedLimit.ttl > Date.now()) {
      return cachedLimit.limit;
  } else {
    newTxSizeLimit = await getTxSizeLimitFromPostgres();
    cachedLimit = {
      limit: newTxSizeLimit,
      ttl: Date.now() + 1000 * 60 * 60 // 1 hour
    };
    return newTxSizeLimit;
  }
}