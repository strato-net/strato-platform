

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
    // cy.wait(7000)
    cy.get("#product-list")
    cy.get("#productCard").first().click()
    cy.get('#price').then(productPrice => {
      cy.get('#buyNow')
      cy.get('#buyNow').click()
      cy.wait(5000)
      cy.get('#totalPrice')
      cy.get('#totalPrice').invoke('text').then(totalPriceText => {
        cy.get('#submit-order-button')
        cy.get('#submit-order-button').click()
        // cy.get('#productPrice')
        cy.url('/checkout')
        cy.wait(10000)
        cy.get('#productPrice').invoke('text').then(productPriceText => {
          const totalPrice = totalPriceText.trim();
          const productPrice = productPriceText.trim();
          expect(totalPrice).to.equal(productPrice);
        });
      });

      // cy.get('#submit-order-button')
      // cy.get('#submit-order-button').click();
      // cy.url('/confirmOrder')
      // cy.get('#address-list')
      cy.wait(15000)
      cy.get('#address-list').then($element => {
        // If element exists
        if ($element.length > 0) {
          cy.get('#address-list')
          cy.get('#address-0')
          cy.get('#address-0').click();
        } else {
          cy.get('#add-Address')
          cy.get('#add-Address').click();
          // Fill Address Fields--------
          cy.get('input[name=name]')
          cy.get('input[name=name]').type('user-01').should('have.value', 'user-01')

          cy.get('input[name=addressLine1]')
          cy.get('input[name=addressLine1]').type('Address-line-01').should('have.value', 'Address-line-01')

          cy.get('input[name=addressLine2]')
          cy.get('input[name=addressLine2]').type('Address-line-02').should('have.value', 'Address-line-02')

          cy.get('input[name=city]')
          cy.get('input[name=city]').type('Dallas').should('have.value', 'Dallas')

          cy.get('input[name=state]')
          cy.get('input[name=state]').type('Dallas').should('have.value', 'Dallas')

          cy.get('input[name=zipcode]')
          cy.get('input[name=zipcode]').type('12345').should('have.value', '12345')

          cy.get('input[name=country]')
          cy.get('input[name=country]').type('United States').should('have.value', 'United States')
          // Fill Address Fields--------
          cy.get('#add-Address-Btn')
          cy.get('#add-Address-Btn').click()

          cy.wait(15000)
          cy.get('#address-list')
          cy.get('#address-0')
          cy.get('#address-0').click();
        }
      })

      cy.get('#pay-now-button')
      cy.get('#pay-now-button').click();
      cy.wait(10000)
      cy.url('checkout.stripe.com')

      cy.get('input[name=email]')
      cy.get('input[name=email]').type('tanuj@blockapps.net').should('have.value', 'tanuj@blockapps.net')

      cy.get('#card-tab')
      cy.get('#card-tab').click()

      cy.get('input[name=cardNumber]')
      cy.get('input[name=cardNumber]').type('4000 0035 6000 0008').should('have.value', '4000 0035 6000 0008')

      cy.get('input[name=cardExpiry]')
      cy.get('input[name=cardExpiry]').type('0325').should('have.value', '0325')

      cy.get('input[name=cardCvc]')
      cy.get('input[name=cardCvc]').type('007').should('have.value', '007')

      cy.get('input[name=billingName]')
      cy.get('input[name=billingName]').type('Tanuj Soni').should('have.value', 'Tanuj Soni')

      cy.get('#country-fieldset')
      cy.get('#country-fieldset').click()

      cy.get('select option[value="IN"]').should('be.selected');

      cy.get('button[type="submit"]').click();

      cy.get('#Orders')
      cy.get('#Orders').click();

      cy.get('#bought-tab')
      cy.get('#bought-tab').click()
      // Now check here the order is present or not

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