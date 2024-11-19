describe('Renders User onboarding Page', () => {
  it('should be able to click on login and verify authentication', () => {
    cy.visit('/');
    cy.get('#Login').click();
    cy.login();

    cy.get('#Marketplace').should('exist');
    cy.get('#Orders').should('exist');
    cy.get('#Inventory').should('exist');
    cy.get('#Products').should('exist');
    cy.get('#Events').should('exist');
  });

  it('should be able to logout', () => {
    cy.visit('/');
    cy.get('#Login').click();
    cy.login();

    cy.get('#Marketplace').should('exist');
    cy.get('#Orders').should('exist');
    cy.get('#Inventory').should('exist');
    cy.get('#Products').should('exist');
    cy.get('#Events').should('exist');

    cy.get('#user-dropdown').click();
    cy.get('#logout').click();
    cy.get('#Marketplace').should('exist');
    cy.get('#Orders').should('not.exist');
    cy.get('#Inventory').should('not.exist');
    cy.get('#Products').should('not.exist');
    cy.get('#Events').should('not.exist');
  });
});
