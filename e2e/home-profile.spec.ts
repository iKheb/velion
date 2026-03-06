import { expect, test } from "@playwright/test";

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.describe("critical home/profile flow", () => {
  test.skip(!email || !password, "E2E_EMAIL and E2E_PASSWORD are required for authenticated flow");

  test("login, open home, switch filter, open profile", async ({ page }) => {
    await page.goto("/login");

    await page.getByPlaceholder("Correo").fill(email ?? "");
    await page.getByPlaceholder("Contrasena").fill(password ?? "");
    await page.getByRole("button", { name: "Entrar" }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText("Siguiendo")).toBeVisible();

    await page.getByRole("button", { name: "Reels" }).first().click();
    await expect(page.getByRole("heading", { name: "Reels" }).first()).toBeVisible();

    await page.getByRole("link", { name: "Perfil" }).first().click();
    await expect(page).toHaveURL(/\/profile\//);
    await expect(page.getByText(/^@/).first()).toBeVisible();
  });
});
