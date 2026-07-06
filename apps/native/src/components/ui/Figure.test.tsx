import { render, screen } from "@testing-library/react-native";
import { Figure } from "./Figure";

describe("Figure", () => {
  it("renders dollars and cents with an en-AU accessibility label", async () => {
    await render(<Figure cents={123456} />);

    const figure = screen.getByLabelText("1,234 dollars and 56 cents");
    expect(figure).toBeOnTheScreen();
    expect(figure).toHaveTextContent("$1,234.56");
  });

  it("renders whole dollars with a .00 cents part", async () => {
    await render(<Figure cents={500000} />);

    const figure = screen.getByLabelText("5,000 dollars");
    expect(figure).toHaveTextContent("$5,000.00");
  });

  it("uses a true minus sign and 'minus' label for negatives", async () => {
    await render(<Figure cents={-123456} />);

    // U+2212 true minus, not a hyphen-minus.
    const figure = screen.getByLabelText("minus 1,234 dollars and 56 cents");
    expect(figure).toHaveTextContent("−$1,234.56");
  });

  it("prefixes a + on positive amounts when signed", async () => {
    await render(<Figure cents={5000} signed />);

    const figure = screen.getByLabelText("50 dollars");
    expect(figure).toHaveTextContent("+$50.00");
  });

  it("does not prefix a + on zero when signed", async () => {
    await render(<Figure cents={0} signed />);

    const figure = screen.getByLabelText("0 dollars");
    expect(figure).toHaveTextContent("$0.00");
  });
});
