

describe('Create a new Asset', () => {
  beforeEach(function () {
    cy.visit('/')
    cy.get("#Login").click();
    cy.login()
  });

  it('Add a product', () => {
    cy.url().should("exist");
    cy.get('#myItems').should("exist").click();
    cy.url().should("exist", "myitems");
    // cy.get('#connectStripe').contains('Connect Stripe')
    // cy.get('#connectStripe').contains('Connect Stripe').should('have.attr', 'disabled', 'disabled'); //should be disabled
    cy.get('#createItem').should('not.have.attr', 'disabled');
    cy.get('#createItem').click();
    cy.get('#name').type('product - 01');

    cy.get('.ant-select-selector').then(($elements) => {
      cy.wrap($elements.eq(1))
      cy.wrap($elements.eq(1)).click();
    });

    cy.wait(7000)
    cy.get('[title="Art"]').should('have.attr', 'title', 'Art').first()
    cy.get('[title="Art"]').should('have.attr', 'title', 'Art').first().click();

    // cy.get('#subCategory');
    // cy.get('#subCategory').click();

    // cy.get('[title="Art"]').should('have.attr', 'title', 'Art').eq(1)
    // cy.get('[title="Art"]').should('have.attr', 'title', 'Art').eq(1).click();

    // cy.get('#imageUpload')
    // cy.get('#imageUpload').click();

    cy.get("input[type=file]").first()
    cy.get("input[type=file]").first().attachFile("cottonSeeds.jpg")
    cy.get("#createItem")
    cy.get("#createItem").click()
    cy.wait(7000)


  })


  it.only('Buy a product', () => {
    cy.visit('/')
    cy.get("#viewAll")
    cy.get("#viewAll").click()
    cy.get("#product-list")
    cy.get("#productCard").first().click()
    cy.get('#price').then(productPrice => {
      cy.get('#buyNow')
      cy.get('#buyNow').click()
      cy.url('/checkout')
      // cy.get('#totalPrice').then(cartPrice => {
      //   expect(productPrice).to.equal(cartPrice);
      // });

      cy.get('#totalPrice').invoke('text').then(totalPriceText => {
        cy.get('#productPrice').invoke('text').then(productPriceText => {
          const totalPrice = totalPriceText.trim();
          const productPrice = productPriceText.trim();
          expect(totalPrice).to.equal(productPrice);
        });
      });
    });
    // cy.get("#Art")
    // cy.get("#Art").click()

    //  cy.get("#product-list")

    //  cy.url().should("exist", "/c/All")
    //  cy.get(".trending_cards_container_card");
    //  cy.get(".trending_cards_container_card");
    //  cy.get(".trending_cards_container_card").first().click();
    //  cy.wait(7000)

  })
})