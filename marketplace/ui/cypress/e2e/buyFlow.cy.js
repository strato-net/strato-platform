import dayjs from "dayjs";

describe('Create a new Asset', () => {
  const productName = `Product-${dayjs().unix()}`;
  const userName = `User-${dayjs().unix()}`;
  const artistName = `User-${dayjs().unix()}`;

  // beforeEach(function () {
  //   cy.visit('/');
  //   cy.get("#Login").click();
  //   cy.login();
  // });

  it.only('It should add a new product', () => {
    cy.visit('/');
    cy.get("#Login").click();
    cy.login(Cypress.env("sellerEmail"), Cypress.env("sellerPassword"))
    cy.wait(10000)
    cy.get('#avatar')
    cy.url('').should("exist");
    cy.get('#Inventory').should("exist").click();
    cy.url().should("exist", "myitems");
    cy.get('#createItem').should('not.have.attr', 'disabled');
    cy.get('#createItem').click();
    cy.get('#name').type(productName);

    cy.get('.ant-select-selector').then(($elements) => {
      cy.wrap($elements.eq(1))
      cy.wrap($elements.eq(1)).click();
    });

    cy.wait(7000)
    cy.get('[title="Art"]').should('have.attr', 'title', 'Art').first()
    cy.get('[title="Art"]').should('have.attr', 'title', 'Art').first().click();

    cy.get('#subCategory');
    cy.get('#subCategory').click();
    cy.wait(3000)
    cy.get('#subCategory-options')
    cy.get('#subCategory-options').should('have.attr', 'title', 'Art')
    cy.get('#subCategory-options').should('have.attr', 'title', 'Art').click()

    cy.get('#artist')
    cy.get('#artist').type(artistName).should('have.value', artistName)

    cy.get('.tiptap')
    cy.get('.tiptap').eq(1).click();
    cy.get('.ProseMirror-focused').first().type('user-01')

    cy.get("input[type=file]").first()
    cy.get("input[type=file]").first().attachFile("cottonSeeds.jpg")
    cy.get("#createItemSubmit")
    cy.get("#createItemSubmit").click()
    cy.wait(7000)
    cy.get("#user-dropdown").click()

  })

  it('It should buy a product', () => {
    cy.visit('/');
    cy.get("#Login").click();
    cy.login();
    cy.visit('/');
    cy.get("#viewAll").click();
    cy.get("#product-list");
    // cy.get(`asset-${productName}`)
    // cy.get(`asset-${productName}`).click()
    cy.get("#productCard")
    cy.get("#productCard").first().click();
    cy.get('#price').then(productPrice => {
      cy.get('#buyNow').click();
      cy.wait(5000);
      cy.get('#totalPrice').invoke('text').then(totalPriceText => {
        cy.get('#submit-order-button').click();
        cy.url().should('include', '/checkout');
        cy.wait(10000);
        cy.get('#productPrice').invoke('text').then(productPriceText => {
          const totalPrice = totalPriceText.trim();
          const productPrice = productPriceText.trim();
          expect(totalPrice).to.equal(productPrice);
        });
      });
    });

    cy.wait(12000);
    cy.get('#add-address-text').should('exist', { timeout: 10000 }).then($element => {
      cy.wait(6000)
      cy.get('#add-Address-card-btn').click();

      cy.get('#add-Address-card-btn').click();
      cy.get('input[name=name]').type('user-01').should('have.value', 'user-01');
      cy.get('input[name=addressLine1]').type('Address-line-01').should('have.value', 'Address-line-01');
      cy.get('input[name=addressLine2]').type('Address-line-02').should('have.value', 'Address-line-02');
      cy.get('input[name=city]').type('Dallas').should('have.value', 'Dallas');
      cy.get('input[name=state]').type('Dallas').should('have.value', 'Dallas');
      cy.get('input[name=zipcode]').type('12345').should('have.value', '12345');
      cy.get('input[name=country]').type('United States').should('have.value', 'United States');
      cy.get('#add-Address-Btn').click();
    })

    cy.wait(15000);
    cy.get('#address-0').click();

    cy.get('#pay-now-button').click();
    cy.wait(60000)
    cy.get('input[name=email]')
    cy.get('input[name=email]').type(`${userName}@blockapps.net`).should('have.value', `${userName}@blockapps.net`);
    cy.get('#card-tab').click();
    cy.get('input[name=cardNumber]').type('4000 0035 6000 0008').should('have.value', '4000 0035 6000 0008');
    cy.get('input[name=cardExpiry]').type('0325')
    cy.get('input[name=cardCvc]').type('007').should('have.value', '007');
    cy.get('input[name=billingName]').type('Tanuj Soni').should('have.value', 'Tanuj Soni');
    cy.get('#country-fieldset').click();
    cy.get('select option[value="IN"]').should('be.selected');
    cy.get('button[type="submit"]').click();


    cy.wait(120000);
    cy.get('#Orders')
    cy.get('#Orders').click();
    cy.get('#bought-tab')
    cy.get('#bought-tab').click();
  });
});
