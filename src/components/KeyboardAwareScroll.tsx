// Standard keyboard handling for form screens: the active input stays visible
// when the keyboard opens, and tapping outside any field dismisses it.
//
// - KeyboardAvoidingView: "padding" on iOS, "height" on Android.
// - keyboardVerticalOffset: pass the navigation header height for screens shown
//   with a header (default 0 for header-less screens).
// - Tap-outside-to-dismiss via TouchableWithoutFeedback + Keyboard.dismiss.
// - keyboardShouldPersistTaps="handled" so taps on buttons/inputs still work
//   while the keyboard is open.

import type { ReactNode } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  type StyleProp,
  TouchableWithoutFeedback,
  type ViewStyle,
} from "react-native";

export function KeyboardAwareScroll({
  children,
  contentContainerStyle,
  offset = 0,
  style,
}: {
  children: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  offset?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={offset}
      style={[{ flex: 1 }, style]}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <ScrollView
          contentContainerStyle={contentContainerStyle}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}
