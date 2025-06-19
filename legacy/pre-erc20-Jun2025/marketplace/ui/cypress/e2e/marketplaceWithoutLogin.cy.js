describe('Renders Marketplace Page - No Authentication', () => {
  it('it should render marketplace dashboard', () => {
    cy.visit('/');
    cy.url().should('include', '/marketplace');
    cy.contains('Explore New Products').should('exist');
    cy.get('.relative')
      .find('img')
      .should('have.attr', 'src')
      .should('include', 'hero');
    cy.get('#viewMore').contains('View More').should('exist');
    cy.request({
      method: 'GET',
      url: '/api/v1/category',
    }).then(({ status, body }) => {
      expect(status).to.eq(200);
      cy.contains('Categories').should('be.visible');

      if (body.data.length !== 0) {
        let name = body.data[0].name;
        cy.contains(name).should('be.visible');
      }
    });
    cy.request({
      method: 'GET',
      url: '/api/v1/marketplace/topSelling?offset=0',
    }).then(({ status, body }) => {
      expect(status).to.eq(200);
      cy.contains('Top Selling Products').should('be.visible');
      if (body.data.length !== 0) {
        let name = decodeURIComponent(body.data[0].name);
        cy.contains(name).should('be.visible');
      }
      cy.get('#topSelling').children().should('have.length', 3);
    });
  });

  it('it should render product list page', () => {
    cy.visit('/');
    cy.url().should('contain', 'marketplace');

    cy.get('#viewMore').should('exist');
    cy.get('#viewMore').should('be.enabled').click();
    cy.url().should('contain', '/marketplace/category');
    cy.get('nav').contains('Home').should('exist');
    cy.contains('Filters').should('exist');
    cy.contains('Categories').should('exist');
    cy.contains('Price').should('exist');
    cy.contains('Quantity').should('exist');
    cy.contains('Sub-Category').should('exist');
    cy.contains('Products found').should('be.visible');
    cy.get('#product-list').should('exist');
    cy.request({
      method: 'GET',
      url: '/api/v1/marketplace?range[]=quantity,0,1000000&range[]=pricePerUnit,0,100000000',
    }).then(({ status, body }) => {
      expect(status).to.eq(200);
      cy.get('#product-list')
        .children()
        .should('have.length', body.data.length);
    });
  });

  it('it should render product detail page', () => {
    cy.visit('/');
    cy.request({
      method: 'GET',
      url: `/api/v1/marketplace/topselling?offset=0`,
    }).then(({ status, body }) => {
      expect(status).to.eq(200);
      if (body.data.length !== 0) {
        let inventory = body.data[0];
        cy.get('#topSelling').should('exist');
        cy.get('#topSellingChild').should('exist');
        cy.get('#topSelling').children().first().click();

        cy.url().should('include', '/marketplace/productList/');
        cy.get('nav').contains('Home').should('exist');
        cy.get('nav')
          .contains(decodeURIComponent(inventory.name))
          .should('exist');
        cy.get('div').find('img').should('have.attr', 'src');
        cy.get('button').contains('Add To Cart').should('exist');
        cy.get('button').contains('Buy Now').should('exist');

        cy.contains(decodeURIComponent(inventory.name)).should('be.visible');
        if (inventory.description)
          cy.get('#details')
            .contains(decodeURIComponent(inventory.description))
            .should('exist');
        cy.get('#details')
          .contains(`$ ${inventory.pricePerUnit}`)
          .should('be.visible');
        cy.get('#details').contains('Quantity').should('be.visible');
        cy.get('#quantity').should('exist');
        cy.get('.ant-tabs-tab').should('have.length', 1);
        cy.contains('Product Id').should('be.visible');
        cy.contains('Unique Product Code').should('be.visible');
        cy.contains('Manufacturer').should('be.visible');
        cy.contains('Unit of Measurement').should('be.visible');
        cy.contains('Least Sellable Unit').should('be.visible');
      }
    });
  });
});
