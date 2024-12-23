import { Images } from '../images';
import {
  AMEX,
  Discover,
  Mastercard,
  VISA,
  BANK,
} from '../images/SVGComponents';
import { SEO } from './seoConstant';
import { Row, Col } from 'antd';

export const apiUrl = process.env.REACT_APP_URL
  ? process.env.REACT_APP_URL + '/api/v1'
  : '/api/v1';

export const fileServerUrl =
  window.FILE_SERVER_URL === '__FILE_SERVER_URL__'
    ? 'https://fileserver.mercata-testnet2.blockapps.net/highway' // hardcoding for non-dockerized dev mode
    : window.FILE_SERVER_URL;

export const cirrusUrl = process.env.REACT_APP_URL
  ? process.env.REACT_APP_URL + '/cirrus/search'
  : '/cirrus/search';

export const HTTP_METHODS = {
  GET: 'GET',
  POST: 'POST',
  PATCH: 'PATCH',
  PUT: 'PUT',
};

export const homeUrl = new URL('/', window.location.origin).toString();
export const ordersBaseUrl = new URL(
  '/transactions?type=Order',
  window.location.origin
).toString();
export const transfersBaseUrl = new URL(
  '/transactions?type=Transfer',
  window.location.origin
).toString();
export const soldOrderDetailssBaseUrl = new URL(
  '/sold-orders',
  window.location.origin
).toString();
export const boughtOrderDetailssBaseUrl = new URL(
  '/bought-orders',
  window.location.origin
).toString();

export const UNIT_OF_MEASUREMENTS = {
  1: 'LB',
  2: 'Ounce',
  3: 'Ton',
  4: 'Bag',
  5: 'Box',
  6: 'Piece',
  7: 'Bale',
  8: 'Gallon',
  9: 'Pound',
  10: 'Yard',
  11: 'Kilogram',
};

export const US_DATE_FORMAT = 'MM/DD/YYYY';
export const DATE_TIME_FORMAT = 'MMM D, YYYY h:mm A';

export const MAX_QUANTITY = 1000000;
export const MAX_PRICE = 100000000;

export const INVENTORY_STATUS = {
  PUBLISHED: 1,
  UNPUBLISHED: 2,
  1: 'Published',
  2: 'Unpublished',
};

export const OLD_SADDOG_ORIGIN_ADDRESS =
  'dbf23119bb52a7419c66c7b5055dd3f31545dc14';

export const getUnitNameByIndex = (index) => {
  const unit = unitOfMeasures.find(
    (measure) => measure.value === parseInt(index)
  );

  if (unit) {
    if (unit.name.length > 20) {
      // Extract abbreviation from inside brackets
      const matches = unit.name.match(/\((.*?)\)/);
      if (matches && matches.length > 1) {
        return matches[1];
      }
    }

    return unit.name;
  }

  return null;
};

export const getSpiritUnitNameByIndex = (index) => {
  const unit = unitOfSpiritMeasures.find(
    (measure) => measure.value === parseInt(index)
  );

  if (unit) {
    if (unit.name.length > 20) {
      // Extract abbreviation from inside brackets
      const matches = unit.name.match(/\((.*?)\)/);
      if (matches && matches.length > 1) {
        return matches[1];
      }
    }

    return unit.name;
  }

  return null;
};

export const unitOfMeasures = [
  { name: 'Gram (G)', value: 1 },
  { name: 'Kilogram (KG)', value: 2 },
  { name: 'Troy Ounce (t oz)', value: 3 },
  { name: 'Troy Pound (t lb)', value: 4 },
  { name: 'Avoirdupois Ounce (AVDP Oz)', value: 5 },
  { name: 'Avoirdupois Pound (AVDP Lb)', value: 6 },
  { name: 'Metric Ton (TON)', value: 7 },
  { name: 'Imperial Ton (TONNE)', value: 8 },
];

export const unitOfSpiritMeasures = [
  { name: 'Barrel', value: 1 },
  { name: 'Bottle', value: 2 },
  { name: 'Liter', value: 3 },
];

export const CHARGES = {
  SHIPPING: 0,
  TAX: 0,
};
export const MAX_RAW_MATERIAL = 8;

export const STATUS_FILTER = [
  {
    text: 'Pending',
    value: 'Pending',
  },
  {
    text: 'Approved',
    value: 'Approved',
  },
  {
    text: 'Rejected',
    value: 'Rejected',
  },
];

export const STATUS = {
  0: '',
  1: 'Pending',
  2: 'Approved',
  3: 'Rejected',
  Pending: 1,
  Approved: 2,
  Rejected: 3,
};

export const APPROVAL_STATUS = {
  1: 'Accept',
  2: 'Reject',
  Accept: 1,
  Reject: 2,
};

export const CATEGORIES = [
  'Art',
  'CarbonOffset',
  'Metals',
  'Clothing',
  'Membership',
  'CarbonDAO',
  'Collectibles',
];

export const spiritTypes = [
  { value: 'Whiskey', label: 'Whiskey' },
  { value: 'Rye', label: 'Rye' },
  { value: 'Bourbon', label: 'Bourbon' },
  { value: 'Tequila', label: 'Tequila' },
  { value: 'Gin', label: 'Gin' },
  { value: 'Rum', label: 'Rum' },
  { value: 'Cognac', label: 'Cognac' },
  { value: 'Brandy', label: 'Brandy' },
  { value: 'Port', label: 'Port' },
  { value: 'Sherry', label: 'Sherry' },
];

export const PAYMENT_TYPE = [
  {
    name: 'Credit Card / ACH',
    value: 1,
    options: [
      <AMEX width="30px" height="20px" />,
      <Discover width="30px" height="20px" />,
      <Mastercard width="30px" height="20px" />,
      <VISA width="30px" height="20px" />,
      <BANK width="30px" height="20px" />,
    ],
  },
];

export const PAYMENT_LABEL = {
  Stripe: 'Pay with Credit Card / ACH',
  USDST: 'Pay with USDST (Express Checkout)',
};

export const SIZES = {
  shoes: [
    '3.5',
    '4',
    '4.5',
    '5',
    '5.5',
    '6',
    '6.5',
    '7',
    '7.5',
    '8',
    '8.5',
    '9',
    '9.5',
    '10',
    '10.5',
    '11',
    '11.5',
    '12',
    '12.5',
    '13',
    '13.5',
    '14',
    '14.5',
    '15',
    '16',
    '17',
    '18',
  ],
  other: ['OS (One Size)', 'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL'],
};

export const INVENTORY_MODAL_INITIAL_VALUES = {
  name: '',
  description: '',
  artist: '',
  source: '',
  leastSellableUnits: 1,
  unitOfMeasurement: 1,
  purity: '',
  quantity: 1,
  expirationPeriodInMonths: 1,
  clothingType: null,
  images: [],
  files: [],
  category: 'Art',
  subCategory: null,
  size: null,
  skuNumber: null,
  condition: null,
  brand: null,
};

export const ORDER_STATUS = {
  AWAITING_FULFILLMENT: 1,
  AWAITING_SHIPMENT: 2,
  CLOSED: 3,
  CANCELED: 4,
  PAYMENT_PENDING: 5,
};

export const REDEMPTION_STATUS = {
  PENDING: 1,
  FULFILLED: 2,
  REJECTED: 3,
  1: 'Pending',
  2: 'Fulfilled',
  3: 'Rejected',
};

export const ASSET_STATUS = {
  ACTIVE: 1,
  PENDING_REDEMPTION: 2,
  RETIRED: 3,
};

export const ISSUER_STATUS = {
  UNAUTHORIZED: '1',
  PENDING_REVIEW: '2',
  AUTHORIZED: '3',
};

export const availabilityOptions = [
  { label: 'For Sale', value: 'forSale' },
  { label: 'Sold Out', value: 'soldOut' },
];

export const PAYMENT_LIST = ['card', 'us_bank_account'];

export const navItems = [
  { label: <div id="Transactions">My Transactions</div>, key: '1' },
  { label: <div id="Inventory">My Wallet</div>, key: '2' },
  { label: <div id="Activity Feed">Activity Feed</div>, key: '3' },
];

const metaImg = SEO.IMAGE_META;

const bannerConfig = [
  {
    icon: Images.Icon_1,
    step: 'Step 1',
    description: 'View Verified RWA Listings',
  },
  {
    icon: Images.Icon_2,
    step: 'Step 2',
    description: 'Select the Assets You Want',
  },
  {
    icon: Images.Icon_3,
    step: 'Step 3',
    description: 'Buy RWA Tokens',
  },
  {
    icon: Images.Icon_4,
    step: 'Step 4',
    description: 'Trade or Redeem Tokens',
  },
];

export const BANNER = [
  {
    label: 'Staking',
    link: '/stake',
    text: (
      <div className="staking_banner_text banner-text flex justify-between">
        <div className="banner-text">
          <h1 className="title"> RWA X DeFi </h1>
          <h1 className="w-3/4 mt-1 md:text-3xl font-medium sm:text-2xl text-sm">
            Stake silver and gold to earn and gain access to CATA, our
            governance token!
          </h1>
        </div>
        <div>
          <img
            src={Images.cata}
            alt={'Cata...'}
            title={'Cata'}
            className="md:w-[160px] md:h-[160px] w-[120px] h-[120px] z-[11] relative md:mr-64 mr-48"
          />
        </div>
      </div>
    ),
    desktopText: 'Stake now',
    mobileText: 'Stake',
    alt: metaImg,
    title: metaImg,
    desktopImg: Images.StakingX1600,
    laptopImg: Images.StakingX1440,
    tabletImg: Images.StakingX768,
    mobileImg: Images.StakingX394,
  },
  // {
  //   label: 'Batman',
  //   link: '/c/Clothing?sc=Clothing',
  //   text: (
  //     <div className="clothing_banner_text banner-text">
  //       <h1> The Official DC Drop </h1>
  //       <h1> is Live </h1>
  //     </div>
  //   ),
  //   desktopText: 'Explore More',
  //   mobileText: 'Explore',
  //   alt: metaImg,
  //   title: metaImg,
  //   desktopImg: Images.BatmanX1600,
  //   laptopImg: Images.BatmanX1440,
  //   tabletImg: Images.BatmanX768,
  //   mobileImg: Images.BatmanX394,
  // },
  // {
  //   label: 'Rick and Morty',
  //   link: '/c/Clothing?sc=Clothing',
  //   text: (
  //     <div className="clothing_banner_text banner-text">
  //       <h1> Limited Release </h1>
  //       <h1> Warner Bros Apparel </h1>
  //     </div>
  //   ),
  //   desktopText: 'Explore More',
  //   mobileText: 'Explore',
  //   alt: metaImg,
  //   title: metaImg,
  //   desktopImg: Images.RickAndMortyX1600,
  //   laptopImg: Images.RickAndMortyX1440,
  //   tabletImg: Images.RickAndMortyX768,
  //   mobileImg: Images.RickAndMortyX394,
  // },
  // {
  //   label: 'Liquid Gold',
  //   link: '/c/Spirits?sc=Spirits',
  //   text: (
  //     <div className="liquid_gold_text_box banner-text">
  //       <h1> Liquid Gold </h1>
  //       <h1> Whiskey Casks </h1>
  //     </div>
  //   ),
  //   desktopText: 'Explore More',
  //   mobileText: 'Explore',
  //   alt: metaImg,
  //   title: metaImg,
  //   desktopImg: Images.LiquidGoldX1600,
  //   laptopImg: Images.LiquidGoldX1440,
  //   tabletImg: Images.LiquidGoldX768,
  //   mobileImg: Images.LiquidGoldX394,
  // },
  // {
  //   label: 'Collectibles',
  //   link: '/c/Collectibles?sc=Collectibles',
  //   text: (
  //     <div className="collectible_banner_text banner-text ">
  //       <h1> Own Digital </h1>
  //       <h1>Tokenized Collectibles!</h1>
  //     </div>
  //   ),
  //   desktopText: 'Explore More',
  //   mobileText: 'Explore',
  //   alt: metaImg,
  //   title: metaImg,
  //   desktopImg: Images.CollectiblesX1600,
  //   laptopImg: Images.CollectiblesX1440,
  //   tabletImg: Images.CollectiblesX768,
  //   mobileImg: Images.CollectiblesX394,
  // },
  // {
  //   label: 'Clothing',
  //   link: '/c/Clothing?sc=Clothing',
  //   text: (
  //     <div className="clothing_banner_text banner-text">
  //       <h1> Step into Future With Tokenized Clothing </h1>
  //     </div>
  //   ),
  //   desktopText: 'Explore More',
  //   mobileText: 'Explore',
  //   alt: metaImg,
  //   title: metaImg,
  //   desktopImg: Images.ClothingX1600,
  //   laptopImg: Images.ClothingX1440,
  //   tabletImg: Images.ClothingX768,
  //   mobileImg: Images.ClothingX394,
  // },
  // {
  //   label: 'Metal',
  //   link: '/c/Metals?sc=Metals',
  //   text: (
  //     <div className="metal_banner_text banner-text">
  //       <h1>Tokenized Metals</h1>
  //       <h1>Vault-Secure</h1>
  //     </div>
  //   ),
  //   desktopText: 'Explore More',
  //   mobileText: 'Explore',
  //   alt: metaImg,
  //   title: metaImg,
  //   desktopImg: Images.MetalX1600,
  //   laptopImg: Images.MetalX1440,
  //   tabletImg: Images.MetalX768,
  //   mobileImg: Images.MetalX394,
  // },
  // {
  //   label: 'Token',
  //   link: '/c/Tokens?sc=Tokens',
  //   text: (
  //     <div className="token_banner_text_box banner-text">
  //       <h1 className="token_banner_text1">
  //         The Coin with Real Stakes for{' '}
  //         <span style={{ color: '#FFA011' }}>Real Dogs</span>{' '}
  //       </h1>
  //       <h1 className="token_banner_text2">
  //         {' '}
  //         Save Dog Lives with $SADDOGS Token{' '}
  //       </h1>
  //     </div>
  //   ),
  //   desktopText: 'Save Dogs Now',
  //   mobileText: 'Save Dogs Now',
  //   alt: metaImg,
  //   title: metaImg,
  //   desktopImg: Images.TokenX1600,
  //   laptopImg: Images.TokenX1440,
  //   tabletImg: Images.TokenX768,
  //   mobileImg: Images.TokenX394,
  // },
  // {
  //   label: 'How',
  //   link: '/c/All',
  //   text: (
  //     <>
  //       <Row style={{ width: '90%', margin: 'auto' }}>
  //         <Col xs={24} md={24} lg={8}>
  //           <h1 className="how_banner_text_box banner-text"> How It Works </h1>
  //         </Col>
  //         <Col xs={24} md={24} lg={16}>
  //           <div className="banner-block-container">
  //             {bannerConfig.map((item, index) => (
  //               <>
  //                 <div className="banner-block">
  //                   <img
  //                     src={item.icon}
  //                     // style={{ width: '42px', height: '48px' }}
  //                     className="flex banner-icons"
  //                     alt={`icon-${index + 1}`}
  //                   />
  //                   <p className="banner-step">Step {index + 1}</p>
  //                   <p
  //                     className={`banner-step-description ${
  //                       index === 2 && `rwa-class`
  //                     }`}
  //                   >
  //                     {item.description}
  //                   </p>
  //                 </div>
  //                 {index < bannerConfig.length - 1 && (
  //                   <img
  //                     src={Images.banner_arrow}
  //                     className="banner-arrow"
  //                     alt="arrow.."
  //                   />
  //                 )}
  //               </>
  //             ))}
  //           </div>
  //         </Col>
  //       </Row>
  //     </>
  //   ),
  //   desktopText: 'Explore More',
  //   mobileText: 'Explore',
  //   alt: metaImg,
  //   title: metaImg,
  //   desktopImg: Images.HowX1600,
  //   laptopImg: Images.HowX1440,
  //   tabletImg: Images.HowX768,
  //   mobileImg: Images.HowX394,
  // },
];

export const TRANSACTION_STATUS = {
  1: 'Awaiting Fulfillment',
  2: 'Payment Pending',
  3: 'Successful',
  4: 'Canceled',
  5: 'Discarded',
};

export const TRANSACTION_STATUS_COLOR = {
  Order: '#E3F2FD',
  Transfer: '#E0F7FA',
  Redemption: '#FFF3E0',
  Stake: '#E8F5E9',
  Unstake: '#FFEBEE',
};

export const TRANSACTION_STATUS_TEXT= {
  Order: '#1E88E5',
  Transfer: '#00796B',
  Redemption: '#F57C00',
  Stake: '#388E3C',
  Unstake: '#D32F2F',
};

export const TRANSACTION_STATUS_CLASSES = {
  1: {
    textClass: 'bg-[#FF8C0033]',
    bgClass: 'bg-[#FF8C00]',
  },
  2: {
    textClass: 'bg-[#FF8C0033]',
    bgClass: 'bg-[#FF8C00]',
  },
  3: {
    textClass: 'bg-[#119B2D33]',
    bgClass: 'bg-[#119B2D]',
  },
  4: {
    textClass: 'bg-[#FFF0F0]',
    bgClass: 'bg-[#FF0000]',
  },
  5: {
    textClass: 'bg-[#FFF0F0]',
    bgClass: 'bg-[#FF0000]',
  },
};

export const REDEMPTION_STATUS_CLASSES = {
  1: {
    textClass: 'bg-[#FF8C0033]',
    bgClass: 'bg-[#FF8C00]',
  },
  2: {
    textClass: 'bg-[#119B2D33]',
    bgClass: 'bg-[#119B2D]',
  },
  3: {
    textClass: 'bg-[#FFF0F0]',
    bgClass: 'bg-[#FF0000]',
  },
};

export const TRANSACTION_SORT = [
  { label: 'All', value: '0' },
  { label: 'Awaiting Fulfillment', value: '1' },
  { label: 'Awaiting Shipment', value: '2' },
  { label: 'Closed', value: '3' },
  { label: 'Canceled', value: '4' },
  { label: 'Payment Pending', value: '5' },
];

export const DOWNLOAD_OPTIONS = [
  {
    key: 'xls',
    label: 'Excel',
  },
  {
    key: 'csv',
    label: 'CSV',
  },
];
