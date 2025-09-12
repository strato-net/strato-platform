import { promises as fs } from 'fs';
import path from "path";

const ERROR_FILE_NAME = "oracle-error.flag";
const ERROR_FILE_PATH = path.join(process.cwd(), ERROR_FILE_NAME);

class HealthMonitor {

    async appendToErrorFile(error_data: any) {
        try {
            const errorJsonString = JSON.stringify({timestamp: new Date().toISOString(), error: error_data})
            await fs.appendFile(ERROR_FILE_PATH, errorJsonString + '\n');
            console.log('Added the error message to the error file.', errorJsonString);
        } catch (err) {
            console.error('WARNING! Error occurred while appending to the file:', err);
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
                console.error(`Error occurred when checking if error file exists`, err)
                await this.appendToErrorFile('An error occurred while checking the error file: ' + err.message);
                return true;
            }
        }
    }
}

export const healthMonitor = new HealthMonitor();
