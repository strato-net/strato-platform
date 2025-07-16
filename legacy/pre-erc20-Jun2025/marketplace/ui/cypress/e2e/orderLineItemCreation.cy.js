import dayjs from 'dayjs';

describe('OrderLine Items Check', () => {
  it('it should allow seller to change the order status to closed', () => {
    cy.intercept({
      method: 'POST',
      url: '/api/v1/order',
    }).as('ordersCall');

    cy.intercept({
      method: 'GET',
      url: '/api/v1/product?isDeleted=false&category=Art&subCategory=Art',
    }).as('productNameCall');

    cy.visit('/');
    cy.get('#Login').click();
    cy.loginAsSeller();

    const firstProduct = `Art-${dayjs().unix()}`;
    cy.createProduct(firstProduct);
    cy.createInventory(firstProduct);

    const secondProduct = `Art-${dayjs().unix()}`;
    cy.createProduct(secondProduct);
    cy.createInventory(secondProduct);

    cy.get('#user-dropdown').click();
    cy.get('#logout').click();
    cy.get('#Orders').should('not.exist');
    cy.get('#Login').click();
    cy.login();

    cy.get('#Marketplace').should('exist');
    cy.get('#Marketplace').click();
    cy.url().should('include', '/marketplace');

    cy.get('#Art').should('exist');
    cy.get('#Art').click();

    cy.get(`#${firstProduct}-buy-now`).should('exist');
    cy.get(`#${firstProduct}-buy-now`).click();

    cy.get('#Marketplace').should('exist');
    cy.get('#Marketplace').click();
    cy.url().should('include', '/marketplace');

    cy.get('#Art').should('exist');
    cy.get('#Art').click();

    cy.get(`#${secondProduct}-buy-now`).should('exist');
    cy.get(`#${secondProduct}-buy-now`).click();

    cy.url().should('include', '/marketplace/checkout');
    cy.get('#submit-order-button').should('exist');
    cy.get('#submit-order-button').click();
    cy.url().should('include', '/marketplace/confirmOrder');

    cy.request({
      method: 'GET',
      url: '/api/v1/order/userAddresses/user',
    }).then(({ status, body }) => {
      console.log(body);
      expect(status).to.eq(200);
      if (body.data.length == 0) {
        cy.get('input[placeholder="Enter Name"]').type('Shubham Dubey');
        cy.get('input[placeholder="Enter Zipcode"]').type('32545');
        cy.get('input[placeholder="Enter State"]').type('NY');
        cy.get('input[placeholder="Enter City"]').type('NYC');
        cy.get('textarea[placeholder="Enter Address Line 1"]').type(
          'Street A, near block'
        );
        cy.get('#add-address-button').should('exist');
        cy.get('#add-address-button').click();
      }
    });
    cy.get('#pay-later-button').should('exist');
    cy.get('#pay-later-button').click();
    cy.get('#modal-title').contains('Confirm Order');
    cy.get('#yes-button').should('exist');

    cy.get('#yes-button')
      .click()
      .then(() => {
        cy.wait('@ordersCall', { timeout: 60000 })
          .its('response.body')
          .then((body) => {
            let orderAddress = body.data[0][1];
            if (orderAddress) {
              cy.contains('Order created successfully').should('be.visible');
              cy.get('#user-dropdown').click();
              cy.get('#logout').click();
              cy.get('#Orders').should('not.exist');

              cy.visit('/');
              cy.get('#Login').click();
              cy.loginAsSeller();

              cy.get('#Orders').should('exist');
              cy.visit(`/marketplace/sold-orders/${orderAddress}`);
              cy.url().should(
                `include`,
                `/marketplace/sold-orders/${orderAddress}`
              );

              cy.get('.ant-picker-input').click();
              cy.get('.ant-picker-today-btn').click();
              cy.get('#save-button').should('exist');
              cy.get('#save-button').click();

              //orderline Items confirmation
              cy.contains('Item created successfully').should('be.visible');
              cy.contains('Item created successfully').should('be.visible');

              //status confirmation
              cy.contains('Order has been updated').should('be.visible');
            }
          });
      });
  });
});
