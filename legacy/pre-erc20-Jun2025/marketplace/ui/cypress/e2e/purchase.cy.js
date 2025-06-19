import dayjs from 'dayjs';

describe('Create a new Asset', () => {
  const min = 10;
  const max = 99;
  const amount = Math.floor(Math.random() * (max - min + 1)) + min;
  const productName = `Product-${dayjs().unix()}`;
  const userName = `User-${dayjs().unix()}`;
  const artistName = `Artist-${dayjs().unix()}`;
  const cardNo = '4000 0035 6000 0008';

  it('It should add a new product', () => {
    // logged in as a seller
    cy.visit('/');
    cy.get('#Login').click();
    cy.login(Cypress.env('sellerEmail'), Cypress.env('sellerPassword'));
    cy.wait(10000);
    //  API-CAll
    cy.request({
      url: `/api/v1/users/me`,
      method: 'GET',
      credentials: 'same-origin',
    }).then((response) => {
      expect(response.status).to.eq(200);
      Cypress.env('sellerName', response.body.data.commonName);
    });

    // Create an item
    cy.get('#avatar');
    cy.url('').should('exist');
    cy.get('#Inventory').should('exist').click();
    cy.url().should('exist', 'mywallet');
    cy.get('#createItem').should('not.have.attr', 'disabled');
    cy.get('#createItem').click();
    cy.get('#name').type(productName);
    cy.get('.ant-select-selector').then(($elements) => {
      cy.wrap($elements.eq(1));
      cy.wrap($elements.eq(1)).click();
    });

    cy.wait(5000);
    cy.get('[title="Art"]').should('have.attr', 'title', 'Art').first();
    cy.get('[title="Art"]').should('have.attr', 'title', 'Art').first().click();

    cy.get('#subCategory');
    cy.get('#subCategory').click();
    cy.wait(3000);
    cy.get('#subCategory-options');
    cy.get('#subCategory-options').should('have.attr', 'title', 'Art');
    cy.get('#subCategory-options').should('have.attr', 'title', 'Art').click();

    cy.get('#artist');
    cy.get('#artist').type(artistName).should('have.value', artistName);

    cy.get('.tiptap');
    cy.get('.tiptap').eq(1).click();
    cy.get('.ProseMirror-focused').first().type(`${productName}-Description`);

    cy.get('input[type=file]').first();
    cy.get('input[type=file]').first().attachFile('cottonSeeds.jpg');
    cy.get('#createItemSubmit');
    cy.get('#createItemSubmit').click();
    cy.wait(7000);

    // List for sale
    cy.url().should('exist', 'mywallet');
    cy.get(`#asset-${productName}`);
    cy.get(`#asset-${productName}`).within(() => {
      cy.get('#sell-listing-btn').click();
    });
    cy.get('#sellPrice');
    cy.get('#sellPrice').type(amount);
    cy.get('#asset-update-list').click();
    cy.wait(15000);
    cy.get('#user-dropdown').click();
    cy.get('#logout').click();
  });

  it('It should buy a product', () => {
    // Login as a buyer
    cy.visit('/');
    cy.get('#Login').click();
    cy.login();

    cy.wait(6000);

    cy.request({
      url: `/api/v1/users/me`,
      method: 'GET',
      credentials: 'same-origin',
    }).then((response) => {
      expect(response.status).to.eq(200);
      cy.wrap(response.body.data.commonName).as('buyerName');
    });

    // Purchase a product
    cy.get('#viewAll').click();
    cy.get('#product-list');
    cy.get(`#asset-${productName}`);
    cy.get(`#asset-${productName}`).click();
    cy.get('#price')
      .invoke('text')
      .then((productPrice) => {
        const Price = productPrice.trim().replace('$', '').replace(' ', '');
        expect(Price).to.equal(`${amount}`);
      });
    cy.get('#buyNow').click();
    cy.get('#review-and-submit').click();

    // Make Payment
    cy.wait(10000);
    cy.get('input[name=email]');
    cy.get('input[name=email]')
      .type(`${userName}@blockapps.net`)
      .should('have.value', `${userName}@blockapps.net`);
    cy.get('#card-tab').click();
    cy.get('input[name=cardNumber]').type(cardNo).should('have.value', cardNo);
    cy.get('input[name=cardExpiry]').type('0327');
    cy.get('input[name=cardCvc]').type('007').should('have.value', '007');
    cy.get('input[name=billingName]')
      .type(userName)
      .should('have.value', userName);
    cy.get('#country-fieldset').click();
    cy.get('#billingCountry').select('US');
    cy.get('select option[value="US"]').should('be.selected');
    cy.get('#billingPostalCode').click().type('323210');
    cy.get('body').then(($body) => {
      if ($body.find('#phoneNumber').length) {
        cy.get('#enableStripePass').click();
      }
    });
    cy.get('button[type="submit"]').click();
    cy.wait(10000);

    cy.url().should('exist', '/order/bought');
    cy.get('#bought-tab');
    cy.wait(10000);

    cy.get('.ant-table-tbody').then((order) => {
      cy.get('.ant-table-row')
        .first()
        .within(() => {
          cy.get('.ant-table-cell').last().should('have.text', 'Closed');
          cy.get('.ant-table-cell').first().click();
        });
    });

    cy.wait(10000);
    cy.get('@buyerName').then((buyerName) => {
      cy.get('#Buyer').should('have.text', buyerName);
      cy.get('#Seller').should('have.text', Cypress.env('sellerName'));
    });

    cy.get('.ant-table-tbody').then((order) => {
      cy.get('.ant-table-row')
        .first()
        .within(() => {
          cy.get('.ant-table-cell')
            .eq(1)
            .children()
            .first()
            .should('have.text', `${productName}`);
          cy.get('.ant-table-cell')
            .eq(2)
            .children()
            .first()
            .should('have.text', `${amount}`);
        });
    });
    cy.wait(3000);
    cy.get('#Inventory').should('exist').click();
    cy.url().should('exist', 'mywallet');
    cy.get(`#asset-${productName}`).should('exist');
    cy.wait(3000);
  });
});
