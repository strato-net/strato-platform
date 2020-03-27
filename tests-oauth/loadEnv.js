import { assert } from 'chai';
import dotenv from 'dotenv';

const loadEnv = dotenv.config();
assert.isUndefined(loadEnv.error);
