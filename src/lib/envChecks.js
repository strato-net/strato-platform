import { env } from '../env';

export const canDeployApps = process.env.NODE_ENV === 'test' ? true : !(env.NODE_NAME.toLowerCase() === "localhost" && env.SINGLE_NODE !== "true");
