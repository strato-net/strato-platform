import constants from "/helpers/constants";

export const eventArgs = (eventTypeAddress,certifierAddress, productAddress, uid, serialNumbers) => {
  const args = {
    eventTypeId: eventTypeAddress,
    productId: productAddress,
    date: 1676030188,
    summary: `summary_${uid}`,
    certifier: certifierAddress,
    serialNumbers: serialNumbers
  }

  return args
}

export const certifyEventArgs = (eventBatchId, uid) => {
  const args = {
    eventBatchId: eventBatchId,
    updates: {
      certifierComment: `comment_${uid}`
    }
  }

  return args
}