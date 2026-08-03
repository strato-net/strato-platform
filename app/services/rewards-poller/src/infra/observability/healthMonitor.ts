import {
  appendErrorRecord,
  errorFileHasContent,
  isMissingErrorFile,
} from "./errorFileSink";
import { logInfo, logError } from "./logger";

class HealthMonitor {
  
  async appendToErrorFile(error_data: string | object) {
    try {
      const errorJsonString = await appendErrorRecord(error_data);
      logInfo('HealthMonitor', 'Added the error message to the error file', { errorJsonString });
    } catch (err) {
      logError('HealthMonitor', err as Error, { operation: 'appendToErrorFile' });
    }
  }
  
  async errorFileExists() {
    try {
      return await errorFileHasContent();
    } catch (err) {
      if (isMissingErrorFile(err)) {
        return false
      } else {
        logError('HealthMonitor', err as Error, { operation: 'errorFileExists' });
        const errorMessage = err instanceof Error ? err.message : String(err);
        await this.appendToErrorFile('An error occurred while checking the error file: ' + errorMessage);
        return true;
      }
    }
  }
}

export const healthMonitor = new HealthMonitor();
