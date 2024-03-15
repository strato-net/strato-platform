// const { SitemapStream, streamToPromise } = require('sitemap');
// const { createWriteStream } = require('fs');

// const urls = [
//   { url: "/certifier", changefreq: "weekly", priority: 0.5 },
//    { url: "/", changefreq: "weekly", priority: 0.5 },
//    { url: "/category", changefreq: "weekly", priority: 0.5 },
//    { url: "/marketplace", changefreq: "weekly", priority: 0.5 },
//    { url: "/profile/:commonName", changefreq: "weekly", priority: 0.5 },
//    { url: "/dp/:address/:name", changefreq: "weekly", priority: 0.5 },
//    { url: "/login", changefreq: "weekly", priority: 0.5 },
//    { url: "/checkout", changefreq: "weekly", priority: 0.5 },
//    { url: "/confirmOrder", changefreq: "weekly", priority: 0.5 },
//    { url: "/products", changefreq: "weekly", priority: 0.5 },
//    { url: "/products/:id", changefreq: "weekly", priority: 0.5 },
//    { url: "/mystore", changefreq: "weekly", priority: 0.5 },
//    { url: "/inventories/:id/:name", changefreq: "weekly", priority: 0.5 },
//    { url: "/inventories/events/serialNumbers", changefreq: "weekly", priority: 0.5 },
//    { url: "/items", changefreq: "weekly", priority: 0.5 },
//    { url: "/order/:type", changefreq: "weekly", priority: 0.5 },
//    { url: "/sold-orders/:id", changefreq: "weekly", priority: 0.5 },
//    { url: "/bought-orders/:id", changefreq: "weekly", priority: 0.5 },
//    { url: "/order/transfers", changefreq: "weekly", priority: 0.5 },
//    { url: "/sold-orders-details/:id", changefreq: "weekly", priority: 0.5 },
//    { url: "/bought-orders-details/:id", changefreq: "weekly", priority: 0.5 },
//    { url: "/orders/events/:itemId", changefreq: "weekly", priority: 0.5 },
//    { url: "/events", changefreq: "weekly", priority: 0.5 },
//    { url: "/events/:id", changefreq: "weekly", priority: 0.5 },
//    { url: "/inventories/events/:id", changefreq: "weekly", priority: 0.5 },
//    { url: "/inventories/events/:inventoryId/:eventTypeId", changefreq: "weekly", priority: 0.5 },
//    { url: "/admin", changefreq: "weekly", priority: 0.5 },
//    { url: "/events/serialNumbers", changefreq: "weekly", priority: 0.5 },
//    { url: "/order/status", changefreq: "weekly", priority: 0.5 },
//    { url: "/orders/invoice/:id", changefreq: "weekly", priority: 0.5 },
//    { url: "/inventories/stripe/onboarding", changefreq: "weekly", priority: 0.5 }
// ]

// const stream = new SitemapStream({ hostname: 'https://workspace-tanuj-a03kf75.mercata-testnet2.blockapps.net' });

// urls.forEach(url => {
//   stream.write(url);
// });

// stream.end();

// const writeStream = createWriteStream('sitemap.xml');

// stream.pipe(writeStream);

// writeStream.on('finish', () => {
//   console.log('Sitemap generated successfully.');
// });

// writeStream.on('error', (error) => {
//   console.error('Error generating sitemap:', error);
// });


