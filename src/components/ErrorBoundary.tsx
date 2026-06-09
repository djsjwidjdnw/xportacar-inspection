// Top-level error boundary. React Native has no built-in one, so without this
// any uncaught render throw white-screens / crashes the whole app — especially
// bad for field inspectors on spotty networks. Wrap the navigation tree with it
// (see App.tsx).

import React from "react";
import { View, Text, Pressable } from "react-native";

interface Props {
  children: React.ReactNode;
}
interface State {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    // Last-resort logging. Wire a crash reporter here (see docs/LAUNCH_CHECKLIST.md).
    if (__DEV__) console.error("[ErrorBoundary]", error);
  }

  reset = () => this.setState({ hasError: false });

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          backgroundColor: "#f9fafb",
        }}
      >
        <Text style={{ fontSize: 18, fontWeight: "800", color: "#101828", marginBottom: 8, textAlign: "center" }}>
          Something went wrong
        </Text>
        <Text style={{ fontSize: 14, color: "#475467", textAlign: "center", marginBottom: 20, lineHeight: 20 }}>
          The app hit an unexpected error. Tap below to try again.
        </Text>
        <Pressable
          onPress={this.reset}
          style={{ backgroundColor: "#1570EF", paddingHorizontal: 20, paddingVertical: 12, borderRadius: 8 }}
        >
          <Text style={{ color: "#fff", fontWeight: "600", fontSize: 14 }}>Try again</Text>
        </Pressable>
      </View>
    );
  }
}
