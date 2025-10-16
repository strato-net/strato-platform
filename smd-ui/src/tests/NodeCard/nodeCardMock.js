import { env } from '../../env';

export const nodeCardInitialState = {
  name: env.NODE_HOST,
  peers: {},
  coinbase: ''
};
