import * as SecureStore from "expo-secure-store";
import { Component, type ReactNode } from "react";
import { Pressable, ScrollView, Text } from "react-native";
import { palette, radius, space, type as t } from "../../theme/tokens";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * Last line of defence: a render throw anywhere below becomes a recoverable
 * screen (with the real message, so TestFlight testers can report it) instead
 * of a silent production crash. "Reset" clears the stored session in case a
 * corrupt credential is what poisons the boot, then re-renders from scratch.
 */
export class RootErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  private async reset() {
    // better-auth expo client persists under this prefix (see src/lib/auth.ts).
    for (const key of ["goodstrata_cookie", "goodstrata_session_data", "goodstrata_session"]) {
      await SecureStore.deleteItemAsync(key).catch(() => {});
    }
    this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: palette.paper }}
        contentContainerStyle={{ padding: space(6), paddingTop: space(20), gap: space(4) }}
      >
        <Text style={{ ...t.eyebrow, color: palette.inkMuted }}>GOODSTRATA</Text>
        <Text style={{ ...t.display, color: palette.ink }}>Something broke</Text>
        <Text style={{ ...t.body, color: palette.inkMuted }}>
          The app hit an unexpected error. Tap reset to clear the stored session and try again — and
          if you can, screenshot this for the developers:
        </Text>
        <Text
          selectable
          style={{
            ...t.figureSmall,
            color: palette.crit,
            backgroundColor: palette.paperRaised,
            borderRadius: radius.card,
            padding: space(4),
          }}
        >
          {this.state.error.message}
          {"\n\n"}
          {this.state.error.stack?.split("\n").slice(0, 8).join("\n")}
        </Text>
        <Pressable
          onPress={() => void this.reset()}
          style={({ pressed }) => ({
            backgroundColor: pressed ? palette.eucalyptPress : palette.eucalypt,
            borderRadius: radius.control,
            alignItems: "center",
            paddingVertical: space(4),
          })}
        >
          <Text style={{ ...t.label, fontSize: 16, color: palette.white }}>
            Reset and try again
          </Text>
        </Pressable>
      </ScrollView>
    );
  }
}
