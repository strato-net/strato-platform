import { SitemapStream, streamToPromise } from 'sitemap';
import { createWriteStream } from 'fs';
import axios from 'axios';

let urls = [
   { url: "/", changefreq: "daily", priority: 0.5, lastmod:Date.now() },
   { url: "/c/all", changefreq: "daily", priority: 0.5, lastmod:Date.now() },
   { url: "/c/Carbon?sc=CarbonOffset%2CCarbonDAO", changefreq: "daily", priority: 0.5, lastmod:Date.now() },
   { url: "/c/Metals?sc=Metals", changefreq: "daily", priority: 0.5, lastmod:Date.now() },
   { url: "/c/Clothing?sc=Clothing", changefreq: "daily", priority: 0.5, lastmod:Date.now() },
   { url: "/c/Collectibles?sc=Collectibles", changefreq: "daily", priority: 0.5, lastmod:Date.now() },
   { url: "/c/Art?sc=Art", changefreq: "daily", priority: 0.5, lastmod:Date.now() },
   { url: "/c/Membership?sc=Membership", changefreq: "daily", priority: 0.5, lastmod:Date.now() },
   { url: "/checkout", changefreq: "daily", priority: 0.5, lastmod:Date.now() },
];

const hostname = 'https://marketplace.mercata.blockapps.net';
const stream = new SitemapStream({ hostname });
const marketplaceUrl = `${hostname}/api/v1/marketplace`;

async function fetchInventories() {
    try {
        const response = await axios.get(marketplaceUrl);
        const res = response.data;
        const data = res?.data.productsWithImageUrl?.map((item,index)=>{
          return { url: `/dp/${item.address}/${item.name}`, changefreq: "daily", priority: 0.5, lastmod: Date.now() };
        });
        return data;
    } catch (error) {
        console.error("Error fetching inventories:", error);
        throw error; 
    }
}

async function generateSitemap() {
  const writeStream = createWriteStream('../ui/public/sitemap.xml');
  try {
    const data = await fetchInventories();

    [...urls, ...data].forEach(url => {
      stream.write(url);
    });

    stream.end();
    stream.pipe(writeStream);
    await streamToPromise(stream);

    console.log('Sitemap generated successfully.');
  } catch (error) {
    console.error('Error generating sitemap:', error);
  }
}

// Call generateSitemap function
// generateSitemap();
export default generateSitemap;
