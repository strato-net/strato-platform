import cron from 'node-cron';
import  generateSitemap from './generateSitemaps.mjs';

const myTask = () => {
    console.log('Cron job executed!');
    generateSitemap()
};

const cronJob = cron.schedule('0 0 * * *', myTask);
const cronFunc = () =>{
cronJob.start();
}

export default cronFunc;
// To stop the cron job:
// cronJob.stop();
