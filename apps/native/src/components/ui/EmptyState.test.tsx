import { fireEvent, render, screen } from "@testing-library/react-native";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("shows the title", async () => {
    await render(<EmptyState icon="document-text-outline" title="No levies yet" />);
    expect(screen.getByText("No levies yet")).toBeOnTheScreen();
  });

  it("shows the body when provided", async () => {
    await render(
      <EmptyState
        icon="document-text-outline"
        title="No levies yet"
        body="New notices appear here once issued"
      />,
    );
    expect(screen.getByText("New notices appear here once issued")).toBeOnTheScreen();
  });

  it("omits the body when not provided", async () => {
    await render(<EmptyState icon="document-text-outline" title="No levies yet" />);
    expect(screen.queryByText("New notices appear here once issued")).toBeNull();
  });

  it("renders the action and fires onAction when pressed", async () => {
    const onAction = jest.fn();
    await render(
      <EmptyState
        icon="document-text-outline"
        title="No levies yet"
        actionLabel="Add a levy"
        onAction={onAction}
      />,
    );

    const action = screen.getByText("Add a levy");
    expect(action).toBeOnTheScreen();

    fireEvent.press(action);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("does not render the action without both label and handler", async () => {
    await render(
      <EmptyState icon="document-text-outline" title="No levies yet" actionLabel="Add a levy" />,
    );
    expect(screen.queryByText("Add a levy")).toBeNull();
  });
});
