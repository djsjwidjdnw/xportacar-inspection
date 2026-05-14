import { useState } from "react";
import {
  Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";

import { Button } from "../components/Button";
import { supabase } from "../lib/supabase";
import { theme } from "../lib/theme";
import { registerForPush } from "../lib/push";

export function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const signIn = async () => {
    if (!email || !password) return Alert.alert("Missing info", "Enter email and password.");
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) {
      Alert.alert("Sign in failed", error.message);
      return;
    }
    registerForPush().catch(() => {});
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.brandRow}>
          <View style={styles.logo}><Text style={styles.logoMark}>X</Text></View>
          <View>
            <Text style={styles.brand}>XportACar</Text>
            <Text style={styles.tagline}>Inspector portal</Text>
          </View>
        </View>

        <Text style={styles.title}>Sign in to start inspections</Text>
        <Text style={styles.subtitle}>Use the credentials provided by your XportACar coordinator.</Text>

        <View style={styles.field}>
          <Text style={styles.label}>Email</Text>
          <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholderTextColor={theme.colors.textLight} style={styles.input} placeholder="inspector@xportacar.com" />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Password</Text>
          <TextInput value={password} onChangeText={setPassword} secureTextEntry placeholderTextColor={theme.colors.textLight} style={styles.input} />
        </View>

        <Button label={loading ? "Signing in…" : "Sign in"} onPress={signIn} loading={loading} fullWidth style={{ marginTop: 4 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: 72, paddingBottom: 48 },
  brandRow:  { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 48 },
  logo:      { width: 40, height: 40, borderRadius: 10, backgroundColor: theme.colors.brand, alignItems: "center", justifyContent: "center" },
  logoMark:  { color: theme.colors.white, fontWeight: "800", fontSize: 20 },
  brand:     { fontSize: 18, fontWeight: "800", color: theme.colors.text },
  tagline:   { fontSize: 11, color: theme.colors.textLight, fontWeight: "600" },
  title:     { fontSize: 26, fontWeight: "800", color: theme.colors.text },
  subtitle:  { marginTop: 6, color: theme.colors.textMuted, fontSize: 14, marginBottom: 24 },
  field:     { marginBottom: 14 },
  label:     { fontSize: 13, fontWeight: "600", color: theme.colors.text, marginBottom: 6 },
  input:     { height: 46, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.borderStrong, paddingHorizontal: 14, fontSize: 15, color: theme.colors.text, backgroundColor: theme.colors.white },
});
