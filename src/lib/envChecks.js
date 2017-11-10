import { env } from '../env';

export const canDeployApps = !(env.NODE_NAME.toLowerCase() === "localhost" && env.SINGLE_NODE !== "true");
