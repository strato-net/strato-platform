describe("Renders User onboarding Page", () => {
    it("it should view the select role page after logging in", () => {
        cy.login();
        cy.wait(30000);
        cy.request({
            method: "GET",
            url: `/api/v1//users/me`,
        }).then(({ status, body }) => {
            expect(status).to.eq(200);
            if (body.data.roles.length == 0 && body.data.pendingMembershipRequests.length == 0) {
                cy.contains("Select Role").should("be.visible");
                cy.contains("Please select the role to access the application").should("be.visible");
                cy.get('.flex input[type="checkbox"]').first().check();
                cy.get("#submit-button").should("exist");
                cy.get("#submit-button").click();
                cy.wait(15000);
                cy.contains("Your request will be reviewed by the Admin").should("be.visible");
            }
        });
    });

    it("it should view the waiting for approval page if role is requested", () => {
        cy.login();
        cy.wait(30000);
        cy.request({
            method: "GET",
            url: `/api/v1/users/me`,
        }).then(({ status, body }) => {
            expect(status).to.eq(200);
            if (body.data.roles.length == 0 && body.data.pendingMembershipRequests.length != 0) {
                cy.contains("Wait for Approval").should("be.visible");
                cy.contains("Thank you for submitting your Role Request. We have successfully received your request and it is currently pending review by the Administrators.").should("be.visible");
            }
        });
    });

    it("it should view the admin page when admin logs in and accept user role request", () => {
        cy.loginAsSeller();
        cy.wait(30000);
        cy.get("#Admin").should("exist");
        cy.get("#Admin").click();
        cy.url().should("include", "/admin");
        cy.request({
            method: "GET",
            url: `/api/v1/membership/requests`,
        }).then(({ status, body }) => {
            expect(status).to.eq(200);
            if (body.data.length != 0) {
                cy.get('#accept').first().click();
                cy.wait(15000);
                cy.contains("Membership request has been updated").should("be.visible");
            }
        });
    });

    it("it should enable user to manage role", () => {
        cy.login();
        cy.wait(30000);
        cy.request({
            method: "GET",
            url: `/api/v1/users/me`,
        }).then(({ status, body }) => {
            expect(status).to.eq(200);
            if (body.data.roles.length != 0) {
                cy.get('#dropdown').click();
                cy.contains('Manage Role').click();
                cy.url().should('include', '/manage/role');
                cy.request({
                    method: "GET",
                    url: `/api/v1/users/me`,
                }).then(({ status, body }) => {
                    expect(status).to.eq(200);
                    cy.get('.flex input[type="checkbox"]').eq(1).check();
                    cy.get("#submit-button").should("exist");
                    cy.get("#submit-button").click();
                    cy.wait(15000);
                    cy.contains("Your request will be reviewed by the Admin").should("be.visible");
                });
            }
        });
    });

    it("it should view the admin page when admin logs in and reject user role request", () => {
        cy.loginAsSeller();
        cy.wait(30000);
        cy.get("#Admin").should("exist");
        cy.get("#Admin").click();
        cy.url().should("include", "/admin");
        cy.request({
            method: "GET",
            url: `/api/v1/membership/requests`,
        }).then(({ status, body }) => {
            expect(status).to.eq(200);
            if (body.data.length != 0) {
                cy.get('#reject').first().click();
                cy.wait(15000);
                cy.contains("Membership request has been updated").should("be.visible");
            }
        });
    });

    it("it should add a new user", () => {
        cy.loginAsSeller();
        cy.wait(30000);
        cy.get("#Admin").should("exist");
        cy.get("#Admin").click();
        cy.url().should("include", "/admin");
        cy.get("#management-tab").should("exist");
        cy.get("#management-tab").click();
        cy.get("#add-user-button").should("exist");
        cy.get("#add-user-button").click();
        cy.wait(10000);
        cy.get("#name").type("NodeOne{enter}");
        cy.get('.flex input[type="checkbox"]').eq(0).check();
        cy.get("#submit-button").should("exist");
        cy.get("#submit-button").click();
        cy.wait(15000);
        cy.contains("User membership added successfully").should("be.visible");
    });
    it("it should edit an existing user", () => {
        cy.loginAsSeller();
        cy.wait(30000);
        cy.get("#Admin").should("exist");
        cy.get("#Admin").click();
        cy.url().should("include", "/admin");
        cy.get("#management-tab").should("exist");
        cy.get("#management-tab").click();
        cy.wait(10000);
        cy.get("#edit-button").should("exist");
        cy.get("#edit-button").click();
        cy.get('.flex input[type="checkbox"]').first().check();
        cy.get("#submit-button").should("exist");
        cy.get("#submit-button").click();
        cy.wait(15000);
        cy.contains("User membership has been updated").should("be.visible");
    });
});
