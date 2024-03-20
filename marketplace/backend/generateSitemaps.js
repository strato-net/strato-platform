import { SitemapStream, streamToPromise } from 'sitemap';
import { createWriteStream } from 'fs';
import axios from 'axios';

let urls = [
   { url: "/", changefreq: "weekly", priority: 0.5 },
   { url: "/c/all", changefreq: "weekly", priority: 0.5 },
   { url: "/c/Carbon?sc=CarbonOffset%2CCarbonDAO", changefreq: "weekly", priority: 0.5 },
   { url: "/c/Metals?sc=Metals", changefreq: "weekly", priority: 0.5 },
   { url: "/c/Clothing?sc=Clothing", changefreq: "weekly", priority: 0.5 },
   { url: "/c/Collectibles?sc=Collectibles", changefreq: "weekly", priority: 0.5 },
   { url: "/c/Art?sc=Art", changefreq: "weekly", priority: 0.5 },
   { url: "/c/Membership?sc=Membership", changefreq: "weekly", priority: 0.5 },
   { url: "/checkout", changefreq: "weekly", priority: 0.5 },
];

const hostname = 'https://marketplace.mercata.blockapps.net';
const stream = new SitemapStream({ hostname });
const marketplaceUrl = `${hostname}/api/v1/marketplace`;

async function fetchInventories() {
    try {
        const response = await axios.get(marketplaceUrl);
        const res = response.data;
        const data = res?.data.productsWithImageUrl?.map((item,index)=>{
          return { url: `/dp/${item.address}/${item.name}`, changefreq: "weekly", priority: 0.9 };
        });
        return data;
    } catch (error) {
        console.error("Error fetching inventories:", error);
        throw error; 
    }
}

async function generateSitemap() {
  const writeStream = createWriteStream('sitemap.xml',{emitClose:true});
  try {
    const data = await fetchInventories();

    [...urls, ...data].forEach(url => {
      stream.write(url);
    });

    
    stream.pipe(writeStream);
    await streamToPromise(stream);
    stream.end();

    stream.close();
    console.log('Sitemap generated successfully.');
  } catch (error) {
    console.error('Error generating sitemap:', error);
  }
}

// Call generateSitemap function
// generateSitemap();
export default generateSitemap;
