import { UNIT_OF_MEASUREMENTS } from "../../../helpers/constants";

const renderImage = (text) => (
  <img className="w-16 h-16 object-cover" alt="" src={text.image} />
);

const renderText = (text) => <p className="text-center">{text}</p>;

export const columnsConfig = [
  {
    title: 'Item',
    dataIndex: 'item',
    render: (text, record) => renderImage(text),
  },
  {
    title: 'Item Name',
    dataIndex: 'item',
    render: (text, record) => renderText(text.name),
  },
  {
    title: 'Seller Organization',
    dataIndex: 'sellerOrganization',
    align: 'center',
    render: (text, record) => renderText(text),
    width: '12%',
  },
  {
    title: 'Unit of Measurement',
    dataIndex: 'unitOfMeasure',
    align: 'center',
    render: (text, record) => renderText(UNIT_OF_MEASUREMENTS[text]),
    width: '12%',
  },
  {
    title: 'Unit Price($)',
    dataIndex: 'unitPrice',
    align: 'center',
    render: (text, record) => renderText(text),
  },
  {
    title: 'Quantity',
    dataIndex: 'qty',
    align: 'center',
    render: (text, record) => renderText(text),
  },
  {
    title: 'Tax($)',
    dataIndex: 'tax',
    align: 'center',
    render: (text, record) => renderText(text),
  },
  {
    title: 'Shipping Charges($)',
    dataIndex: 'shippingCharges',
    align: 'center',
    render: (text, record) => renderText(text),
  },
  {
    title: 'Amount($)',
    dataIndex: 'amount',
    align: 'center',
    render: (text, record) => renderText(Math.trunc(text)),
  },
];
