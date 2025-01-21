import React, { useState, useEffect } from 'react';
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
} from '@react-pdf/renderer';
import { getStringDate } from '../../helpers/utils';
import { US_DATE_FORMAT } from '../../helpers/constants';
import { Images } from '../../images';

const styles = StyleSheet.create({
  page: {
    flexDirection: 'column',
    padding: 10,
  },
  section: {
    margin: 10,
    padding: 0,
  },
  totalSection: {
    margin: 10,
    marginRight: 50,
    padding: 0,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  title: {
    fontSize: 24,
    textAlign: 'center',
    marginBottom: 40,
  },
  label: {
    fontSize: 10,
    marginBottom: 5,
  },
  value: {
    fontSize: 10,
    marginBottom: 10,
  },
  tableHeader: {
    backgroundColor: '#181EAC',
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#999',
    padding: 5,
  },
  tableHeaderColumn: {
    width: '25%',
    color: '#fff',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#999',
    padding: 5,
  },
  tableRowColumn: {
    width: '25%',
  },
  container: {
    position: 'absolute',
    top: 20,
    left: 20,
    width: '25%',
    height: 'auto',
  },
  image: {
    width: '16%',
    height: 'auto',
  },
  textSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '120px',
  },
  bottomSection: {
    margin: 0,
    padding: 0,
  },
  bottomLabel: {
    fontSize: 10,
    marginBottom: 3,
  },
  totalText: {
    fontSize: 12,
    marginBottom: 10,
  },
});

const InvoiceComponent = ({ invoice, is18DecimalPlaces }) => {
  const [subtotal, setSubtotal] = useState(0);
  const [totalTax, settotalTax] = useState(0);
  const formatter = new Intl.NumberFormat('en-US');
  const formattedNum = (num) => formatter.format(num);

  useEffect(() => {
    let tax = 0;

    settotalTax(tax);
    setSubtotal((invoice.order.totalPrice - tax).toFixed(2));
  }, [invoice]);
  const orderQuantities = invoice.order['BlockApps-Mercata-Order-quantities']
    ? invoice.order['BlockApps-Mercata-Order-quantities'].map(
        (item) => item.value
      )
    : invoice.order.quantities;
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.container}>
          <Image style={styles.image} src={Images.logo} />
        </View>
        <View style={styles.section}>
          <Text style={styles.title}>Invoice</Text>
          <View>
            <Text style={styles.label}>
              Order Number:{' '}
              <Text style={styles.value}>{invoice.order.orderId}</Text>
            </Text>
            <Text style={styles.label}>
              Order Date:{' '}
              <Text style={styles.value}>
                {getStringDate(invoice.order.createdDate, US_DATE_FORMAT)}
              </Text>
            </Text>
            <Text style={styles.label}>
              Buyer:{' '}
              <Text style={styles.value}>
                {invoice.order.purchasersCommonName}
              </Text>
            </Text>
            <Text style={styles.label}>
              Seller:{' '}
              <Text style={styles.value}>
                {invoice.order.sellersCommonName}
              </Text>
            </Text>
          </View>
        </View>
        <View style={styles.section}>
          <View style={styles.tableHeader}>
            <Text style={[styles.label, styles.tableHeaderColumn]}>
              Product Name
            </Text>
            <Text style={[styles.label, styles.tableHeaderColumn]}>
              Currency
            </Text>
            <Text style={[styles.label, styles.tableHeaderColumn]}>
              Unit Price
            </Text>
            <Text style={[styles.label, styles.tableHeaderColumn]}>
              Quantity
            </Text>
            <Text style={[styles.label, styles.tableHeaderColumn]}>Amount</Text>
          </View>
          {invoice.assets.map((asset, index) => {
            const adjustedPrice = asset.price;

            const quantity = orderQuantities[index];

            const totalPrice = (asset.price * orderQuantities[index]).toFixed(
              2
            );
            return (
              <View style={styles.tableRow} key={asset.address}>
                <Text style={[styles.value, styles.tableRowColumn]}>
                  {decodeURIComponent(asset.name)}
                </Text>
                <Text style={[styles.value, styles.tableRowColumn]}>
                  {invoice.order.currency}
                </Text>
                <Text style={[styles.value, styles.tableRowColumn]}>
                  {formattedNum(
                    is18DecimalPlaces
                      ? (adjustedPrice * Math.pow(10, 18)).toFixed(2)
                      : adjustedPrice.toFixed(2)
                  )}
                </Text>
                <Text style={[styles.value, styles.tableRowColumn]}>
                  {formattedNum(
                    is18DecimalPlaces
                      ? (quantity / Math.pow(10, 18)).toFixed(2)
                      : quantity
                  )}
                </Text>
                <Text style={[styles.value, styles.tableRowColumn]}>
                  {totalPrice}
                </Text>
              </View>
            );
          })}
        </View>
        <View style={styles.totalSection}>
          <View style={styles.bottomSection}>
            <View style={styles.textSection}>
              <Text style={styles.bottomLabel}>Subtotal</Text>
              <Text style={styles.bottomLabel}>{subtotal}</Text>
            </View>
            <View style={styles.textSection}>
              <Text style={styles.bottomLabel}>Total</Text>
              <Text style={styles.bottomLabel}>
                {invoice.order.totalPrice.toFixed(2)}
              </Text>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  );
};

export default InvoiceComponent;
