import {test,expect} from "@playwright/test";
test("login screen renders required controls",async({page})=>{await page.goto("/");await expect(page.getByRole("heading",{name:"Field Inspection"})).toBeVisible();await expect(page.getByLabel("Email")).toBeVisible();await expect(page.getByLabel("Password")).toBeVisible();});
