import { rest } from 'blockapps-rest'
import RestStatus from 'http-status-codes'
import dappJs from '/dapp/dapp/dapp'
import constants from '../../helpers/constants'
import config from '/load.config'
import { setSearchQueryOptions, searchOne } from '/helpers/utils'
import orgGovernanceJs from '/dapp/org-onboarding/dapp/orgGovernance'

const options = { config }

const loadDapps = async (req, res, next) => {
  const { app, accessToken, username } = req
  const userCredentials = {
    username,
    ...accessToken,
  }
  let address
  try {
    address = await rest.getKey(userCredentials, options)
  } catch (e) {
    // user isn't created in STRATO
    if (e.response.status === RestStatus.BAD_REQUEST) {
      rest.response.status(RestStatus.FORBIDDEN, res)
      return next()
    }

    // unexpected error
    return next(e)
  }

  const user = {
    ...userCredentials,
    node: config.nodes[0],
    address,
  }

  const deploy = app.get(constants.deployParamName)

  req.user = user
  req.dapp = await dappJs.bind(user, deploy.dapp.contract, options)

  return next()
}

export default loadDapps
