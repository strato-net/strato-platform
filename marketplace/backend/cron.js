import cron from 'node-cron';
import { default as generateSitemap } from './sitemap/generateSitemaps.js';

const myTask = () => {
  console.log('Cron job executed!');
  generateSitemap();
};

const cronJob = cron.schedule('0 */12 * * *', myTask);
const cronFunc = () => {
  generateSitemap();
  cronJob.start();
};

export default cronFunc;
// To stop the cron job:
// cronJob.stop();
