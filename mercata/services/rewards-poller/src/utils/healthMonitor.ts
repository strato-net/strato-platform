import { promises as fs } from 'fs';
import path from "path";
import { ERROR_FILE_NAME } from "../config";
import { logInfo, logError } from "./logger";

const ERROR_FILE_PATH = path.join(process.cwd(), ERROR_FILE_NAME);

class HealthMonitor {
  
  async appendToErrorFile(error_data: string | object) {
    try {
      const errorJsonString = JSON.stringify({timestamp: new Date().toISOString(), error: error_data})
      await fs.appendFile(ERROR_FILE_PATH, errorJsonString + '\n');
      logInfo('HealthMonitor', 'Added the error message to the error file', { errorJsonString });
    } catch (err) {
      logError('HealthMonitor', err as Error, { operation: 'appendToErrorFile' });
    }
  }
  
  async errorFileExists() {
    try {
      const stats = await fs.stat(ERROR_FILE_PATH);
      return stats.size > 0
    } catch (err: any) {
      if (err && err['code'] && err['code'] === 'ENOENT') {
        return false
      } else {
        logError('HealthMonitor', err as Error, { operation: 'errorFileExists' });
        await this.appendToErrorFile('An error occurred while checking the error file: ' + err.message);
        return true;
      }
    }
  }
}

export const healthMonitor = new HealthMonitor();

