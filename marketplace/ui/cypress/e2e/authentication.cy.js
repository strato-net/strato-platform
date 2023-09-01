describe("Renders User onboarding Page", () => {
    it("should be able to click on login and verify authentication", () => {
        cy.visit('/')
        cy.get("#login").click();
        cy.login()

        cy.get("#marketplace").should("exist");
        cy.get("#orders").should("exist");
        cy.get("#inventory").should("exist");
        cy.get("#products").should("exist");
        cy.get("#events").should("exist");
    });

    it("should be able to logout", () => {
        cy.visit('/')
        cy.get("#login").click();
        cy.login()

        cy.get("#marketplace").should("exist");
        cy.get("#orders").should("exist");
        cy.get("#inventory").should("exist");
        cy.get("#products").should("exist");
        cy.get("#events").should("exist");


        cy.get("#user-dropdown").click();
        cy.get("#logout").click();
        cy.get("#marketplace").should("exist");
        cy.get("#orders").should("not.exist");
        cy.get("#inventory").should("not.exist");
        cy.get("#products").should("not.exist");
        cy.get("#events").should("not.exist");
    });
});
