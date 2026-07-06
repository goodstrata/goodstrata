import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { SectionHeader } from "./SectionHeader";

describe("SectionHeader", () => {
  it("renders the section label", async () => {
    await render(<SectionHeader label="RECENT ACTIVITY" />);
    expect(screen.getByText("RECENT ACTIVITY")).toBeOnTheScreen();
  });

  it("renders the optional right accent action", async () => {
    await render(<SectionHeader label="LEVIES" right={<Text>View all</Text>} />);
    expect(screen.getByText("LEVIES")).toBeOnTheScreen();
    expect(screen.getByText("View all")).toBeOnTheScreen();
  });

  it("omits the right action when none is provided", async () => {
    await render(<SectionHeader label="DOCUMENTS" />);
    expect(screen.getByText("DOCUMENTS")).toBeOnTheScreen();
    expect(screen.queryByText("View all")).toBeNull();
  });
});
