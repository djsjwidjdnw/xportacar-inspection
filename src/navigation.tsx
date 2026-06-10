import { Platform, View, Text, Pressable } from "react-native";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { LoginScreen as LoginScreenImpl } from "./screens/LoginScreen";
import { RegisterScreen as RegisterScreenImpl } from "./screens/RegisterScreen";
import { DashboardScreen as DashboardScreenImpl } from "./screens/DashboardScreen";
import { InspectionWizardScreen as InspectionWizardScreenImpl } from "./screens/InspectionWizardScreen";

import { useAuth } from "./lib/auth";
import { useTranslation } from "./lib/i18n";
import { theme } from "./lib/theme";

// Roles allowed to use the inspector tool. The buyer app shares this Supabase
// project and lets anyone self-register as 'buyer', so without this gate a
// buyer could sign in here and reach the wizard (their writes are RLS-blocked,
// but they'd hit a confusing dead end).
const STAFF_ROLES = ["inspector", "admin", "superadmin"];

// Shown when a signed-in non-staff user lands here. Plain copy (rare guard
// screen) with a sign-out so they can switch to the buyer app.
function NotAuthorizedScreen() {
  const { signOut } = useAuth();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: theme.colors.bg }}>
      <Text style={{ fontSize: 18, fontWeight: "800", color: theme.colors.text, marginBottom: 8, textAlign: "center" }}>
        Inspectors only
      </Text>
      <Text style={{ fontSize: 14, color: theme.colors.textMuted, textAlign: "center", marginBottom: 20, lineHeight: 20 }}>
        This app is for XportACar field inspectors. Your account doesn&apos;t have inspector access.
      </Text>
      <Pressable
        onPress={() => { void signOut(); }}
        style={{ backgroundColor: theme.colors.brand, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 8 }}
      >
        <Text style={{ color: theme.colors.white, fontWeight: "600", fontSize: 14 }}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const Stack = createNativeStackNavigator();

type AnyScreen = React.ComponentType<Record<string, unknown>>;
const LoginScreen          = LoginScreenImpl          as unknown as AnyScreen;
const RegisterScreen       = RegisterScreenImpl       as unknown as AnyScreen;
const DashboardScreen      = DashboardScreenImpl      as unknown as AnyScreen;
const InspectionWizard     = InspectionWizardScreenImpl as unknown as AnyScreen;

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: theme.colors.bg,
    card:       theme.colors.white,
    primary:    theme.colors.brand,
    text:       theme.colors.text,
    border:     theme.colors.border,
  },
};

export function RootNavigator() {
  const { user, role, loading } = useAuth();
  const { t } = useTranslation();
  if (loading) return null;

  // Block only a CONFIRMED non-staff role. While role is still null (unfetched
  // or a transient error) we fail-open so a real inspector is never locked out.
  const isStaff = role == null || STAFF_ROLES.includes(role);

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          // Native slide transitions are janky in the web export — swap
          // screens instantly on web, keep the native animation on device.
          animation: Platform.OS === "web" ? "none" : "default",
        }}
      >
        {user ? (
          isStaff ? (
            <>
              <Stack.Screen name="Dashboard" component={DashboardScreen} />
              <Stack.Screen
                name="Inspect"
                component={InspectionWizard}
                options={{ headerShown: true, title: t("nav.inspection") }}
              />
            </>
          ) : (
            <Stack.Screen name="NotAuthorized" component={NotAuthorizedScreen} />
          )
        ) : (
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Register" component={RegisterScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
