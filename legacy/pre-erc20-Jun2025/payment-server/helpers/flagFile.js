import { promises as fs } from 'fs';

// Error flag file used for healthcheck
const error_flag_file_path = `${process.env.CONFIG_DIR_PATH || '.'}/errors_list`;

async function appendToErrorFile(error_message) {
  try {
    await fs.appendFile(error_flag_file_path, `${new Date().toISOString()} :: ${error_message}\n`);
    console.log('Added the error message to the error file.');
  } catch (err) {
    console.error('!!! An error occurred while appending to the file:', err);
  }
}

async function isErrorFlagRaised() {
  try {
    const stats = await fs.stat(error_flag_file_path);
    return stats.size > 0
  } catch (err) {
    if (err.code === 'ENOENT') {
      return false
    } else {
      console.error('An error occurred:', err);
      await appendToErrorFile(`${new Date().toISOString()} :: An error occurred while checking the error file: ${err.message}`);
      return true;
    }
  }
}

export default {
  appendToErrorFile,
  isErrorFlagRaised,
}
