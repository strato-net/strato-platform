import React, { useState, useEffect } from 'react';
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';
import { getStringDate } from '../../helpers/utils';
import { US_DATE_FORMAT } from '../../helpers/constants';
import { Images } from "../../images";

const styles = StyleSheet.create({
  page: {
    flexDirection: 'column',
    padding: 10,
  },
  section: {
    margin: 10,
    padding: 0,
    // flexGrow: 1,
  },
  totalSection: {
    margin: 10,
    marginRight: 50,
    padding: 0,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    // flexGrow: 1,
  },
  title: {
    fontSize: 24,
    textAlign: 'center',
    marginBottom: 40,
  },
  label: {
    fontSize: 10,
    marginBottom: 5,
    // textAlign:"center"
  },
  addressTitle: {
    fontSize: 12,
    marginBottom: 5,
  },
  value: {
    fontSize: 10,
    marginBottom: 10,
    // textAlign:"center"
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
    color: "#fff"
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
    width: "120px"
  },
  addressTextSection: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    flexWrap:'wrap',
  },
  bottomSection: {
    margin: 0,
    padding: 0,
  },
  bottomLabel: {
    fontSize: 10,
    marginBottom: 3,
  },
  bottomLabelAddress: {
    fontSize: 10,
    marginBottom: 3,
    width:"50px"
  },
  bottomLabelValue: {
    fontSize: 10,
    marginBottom: 3,
  },
  topSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignContent: 'center',
    marginTop: 20
  },
  addressSection: {
    width: "50%"
  },
  totalText: {
    fontSize: 12,
    marginBottom: 10,
    //  textAlign:"center"
  },
  // separator: {
  //   width: 1,
  //   height: '100%',
  //   backgroundColor: '#000000',
  // },

});

const InvoiceComponent = ({ invoice }) => {
  const [subtotal, setSubtotal] = useState(0);
  const [totalTax, settotalTax] = useState(0);
  const [totalShipping, settotalShipping] = useState(0);


  useEffect(() => {
   
    let tax = 0;
    let shipping = 0;
    invoice.orderLines.forEach(item => {
      tax += item.tax;
      shipping += item.shippingCharges;
    });
   
    settotalTax(tax);
    settotalShipping(shipping);
    setSubtotal(invoice.orderTotal-tax-shipping);
  }, [invoice])



  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.container}>
          <Image style={styles.image} src={Images.logo} />
        </View>
        <View style={styles.section}>
          <Text style={styles.title}>Invoice</Text>
          <View>
            <Text style={styles.label}>Order Number: <Text style={styles.value}>{invoice.orderId}</Text></Text>
            <Text style={styles.label}>Order Date: <Text style={styles.value}>{getStringDate(invoice.orderDate, US_DATE_FORMAT)}</Text></Text>
            <Text style={styles.label}>Buyer: <Text style={styles.value}>{invoice.buyerOrganization}</Text></Text>
            <Text style={styles.label}>Seller: <Text style={styles.value}>{invoice.sellerOrganization}</Text></Text>
          </View>
          <View style={styles.topSection}>
            <View style={styles.addressSection}>
              <Text style={styles.addressTitle}>Address: </Text>
              <View style={styles.addressTextSection}>
                <Text style={styles.bottomLabelAddress}>Name: </Text>
                <Text style={styles.bottomLabelValue}>{decodeURIComponent(invoice.userContactAddress.shippingName)}</Text>
              </View>
              <View style={styles.addressTextSection}>
                <Text style={styles.bottomLabelAddress}>Address: </Text>
                <Text style={styles.bottomLabelValue}>{decodeURIComponent(invoice.userContactAddress.shippingAddressLine1)+", "+decodeURIComponent(invoice.userContactAddress.shippingAddressLine2) }</Text>
              </View>
              <View style={styles.addressTextSection}>
                <Text style={styles.bottomLabelAddress}>City: </Text>
                <Text style={styles.bottomLabelValue}>{decodeURIComponent(invoice.userContactAddress.shippingCity)}</Text>
              </View>
              <View style={styles.addressTextSection}>
                <Text style={styles.bottomLabelAddress}>State: </Text>
                <Text style={styles.bottomLabelValue}>{decodeURIComponent(invoice.userContactAddress.shippingState)}</Text>
              </View>
              <View style={styles.addressTextSection}>
                <Text style={styles.bottomLabelAddress}>Zip code: </Text>
                <Text style={styles.bottomLabelValue}>{decodeURIComponent(invoice.userContactAddress.shippingZipcode)}</Text>
              </View>
            </View>
          </View>
        </View>
        <View style={styles.section}>
          {/* <Text style={styles.title}>Items</Text> */}
          <View style={styles.tableHeader}>
            <Text style={[styles.label, styles.tableHeaderColumn]}>Product Name</Text>
            <Text style={[styles.label, styles.tableHeaderColumn]}>Manufacturer</Text>
            <Text style={[styles.label, styles.tableHeaderColumn]}>Unit Price($)</Text>
            <Text style={[styles.label, styles.tableHeaderColumn]}>Quantity</Text>
            <Text style={[styles.label, styles.tableHeaderColumn]}>Shipping Charges($)</Text>
            <Text style={[styles.label, styles.tableHeaderColumn]}>Tax($)</Text>
            <Text style={[styles.label, styles.tableHeaderColumn]}>Amount($)</Text>
          </View>
          {invoice.orderLines.map(item => (
            <View style={styles.tableRow} key={item.id}>
              <Text style={[styles.value, styles.tableRowColumn]}>{decodeURIComponent(item.productName)}</Text>
              {/* <View style={styles.separator} /> */}
              <Text style={[styles.value, styles.tableRowColumn]}>{decodeURIComponent(item.manufacturer)}</Text>
              {/* <View style={styles.separator} /> */}
              <Text style={[styles.value, styles.tableRowColumn]}>${item.pricePerUnit}</Text>
              {/* <View style={styles.separator} /> */}
              <Text style={[styles.value, styles.tableRowColumn]}>{item.quantity}</Text>
              {/* <View style={styles.separator} /> */}
              <Text style={[styles.value, styles.tableRowColumn]}>${item.shippingCharges}</Text>
              {/* <View style={styles.separator} /> */}
              <Text style={[styles.value, styles.tableRowColumn]}>${item.tax}</Text>
              {/* <View style={styles.separator} /> */}
              <Text style={[styles.value, styles.tableRowColumn]}>${item.amount}</Text>
            </View>
          ))}
          {/* <View style={styles.tableRow} >
              <Text style={[styles.totalText, styles.tableRowColumn]}>Total</Text>
              <Text style={[styles.totalText, styles.tableRowColumn]}></Text>
              <Text style={[styles.totalText, styles.tableRowColumn]}>$300</Text>
              <Text style={[styles.totalText, styles.tableRowColumn]}></Text>
              <Text style={[styles.totalText, styles.tableRowColumn]}>$30</Text>
              <Text style={[styles.totalText, styles.tableRowColumn]}>$30</Text>
              <Text style={[styles.totalText, styles.tableRowColumn]}>$360</Text>
            </View> */}
        </View>
        <View style={styles.totalSection}>
          <View style={styles.bottomSection}>
            <View style={styles.textSection}>
              <Text style={styles.bottomLabel}>Subtotal</Text>
              <Text style={styles.bottomLabel}>${subtotal}</Text>
            </View>
            <View style={styles.textSection}>
              <Text style={styles.bottomLabel}>Tax</Text>
              <Text style={styles.bottomLabel}>${totalTax}</Text>
            </View>
            <View style={styles.textSection}>
              <Text style={styles.bottomLabel}>Shipping</Text>
              <Text style={styles.bottomLabel}>${totalShipping}</Text>
            </View>
            <View style={styles.textSection}>
              <Text style={styles.bottomLabel}>Total</Text>
              <Text style={styles.bottomLabel}>${invoice.orderTotal}</Text>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  );
};

export default InvoiceComponent;
