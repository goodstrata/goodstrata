import { render, screen } from "@testing-library/react-native";
import { StatusPill, statusTone } from "./StatusPill";

describe("statusTone mapping", () => {
  it("maps settled/positive statuses to ok", () => {
    expect(statusTone("paid")).toBe("ok");
    expect(statusTone("approved")).toBe("ok");
    expect(statusTone("active")).toBe("ok");
  });

  it("maps in-flight statuses to warn", () => {
    expect(statusTone("pending")).toBe("warn");
    expect(statusTone("due_soon")).toBe("warn");
    expect(statusTone("partially_paid")).toBe("warn");
    expect(statusTone("draft")).toBe("warn");
  });

  it("maps failed/overdue statuses to crit", () => {
    expect(statusTone("overdue")).toBe("crit");
    expect(statusTone("rejected")).toBe("crit");
    expect(statusTone("cancelled")).toBe("crit");
  });

  it("maps factual, automated and archival statuses to their Registry tones", () => {
    expect(statusTone("scheduled")).toBe("info");
    expect(statusTone("triaged")).toBe("agent");
    expect(statusTone("archived")).toBe("neutral");
  });

  it("normalises casing, whitespace and dashes before lookup", () => {
    expect(statusTone("  PAID  ")).toBe("ok");
    expect(statusTone("Due-Soon")).toBe("warn");
    expect(statusTone("Partially Paid")).toBe("warn");
    expect(statusTone("OVERDUE")).toBe("crit");
  });

  it("defaults unknown statuses to neutral and warns in dev", () => {
    const spy = jest.spyOn(console, "warn").mockImplementation(() => {});
    expect(statusTone("teleported")).toBe("neutral");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("StatusPill component", () => {
  it("renders the provided label text", async () => {
    await render(<StatusPill tone="ok" label="Paid" />);
    expect(screen.getByText("Paid")).toBeOnTheScreen();
  });

  it("renders the label regardless of tone", async () => {
    await render(<StatusPill tone="agent" label="Raised by an agent" />);
    expect(screen.getByText("Raised by an agent")).toBeOnTheScreen();
  });

  it("shows label text verbatim so meaning does not rely on colour", async () => {
    await render(<StatusPill tone="warn" label="Due soon" />);
    const label = screen.getByText("Due soon");
    expect(label).toHaveTextContent("Due soon");
  });
});
