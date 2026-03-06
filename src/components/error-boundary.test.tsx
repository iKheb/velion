import { render, screen } from "@testing-library/react";
import { ErrorBoundary } from "@/components/error-boundary";

const Thrower = () => {
  throw new Error("boom");
};

describe("ErrorBoundary", () => {
  it("renders fallback UI when a child throws", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <ErrorBoundary>
        <Thrower />
      </ErrorBoundary>,
    );

    expect(screen.getByRole("heading", { name: /Velion encontr/i })).toBeInTheDocument();
    spy.mockRestore();
  });
});
