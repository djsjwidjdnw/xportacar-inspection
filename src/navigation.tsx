import { Platform, View, Text, Pressable } from "react-native";
import { NavigationContainer, DefaultTheme, getFocusedRouteNameFromRoute } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LoginScreen as LoginScreenImpl } from "./screens/LoginScreen";
import { RegisterScreen as RegisterScreenImpl } from "./screens/RegisterScreen";
import { DashboardScreen as DashboardScreenImpl } from "./screens/DashboardScreen";
import { InspectionWizardScreen as InspectionWizardScreenImpl } from "./screens/InspectionWizardScreen";
import { ProfileScreen as ProfileScreenImpl } from "./screens/ProfileScreen";

import { Icon } from "./components/Icon";
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
        This app is for XportACar field inspectors. This looks like a buyer account — please sign in on the XportACar website or the buyer app instead.
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
const Tabs = createBottomTabNavigator();

type AnyScreen = React.ComponentType<Record<string, unknown>>;
const LoginScreen          = LoginScreenImpl          as unknown as AnyScreen;
const RegisterScreen       = RegisterScreenImpl       as unknown as AnyScreen;
const DashboardScreen      = DashboardScreenImpl      as unknown as AnyScreen;
const InspectionWizard     = InspectionWizardScreenImpl as unknown as AnyScreen;
const ProfileScreen        = ProfileScreenImpl        as unknown as AnyScreen;

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

// Web-safe SVG tab icon (the inspector avoids vector-icon fonts, which render
// unreliably in the Expo web export).
function makeTabIcon(name: string) {
  return function TabIcon({ focused, color }: { focused: boolean; color: string }) {
    return <Icon name={name} size={focused ? 24 : 22} color={color} />;
  };
}

// The "Inspect" tab: the dashboard plus the inspection wizard pushed on top.
// Keeping the wizard inside this stack lets us hide the tab bar while the
// inspector is deep in a capture flow (see MainTabs).
function InspectStack() {
  const { t } = useTranslation();
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: Platform.OS === "web" ? "none" : "default",
      }}
    >
      <Stack.Screen name="Dashboard" component={DashboardScreen} />
      <Stack.Screen
        name="Inspect"
        component={InspectionWizard}
        options={{ headerShown: true, title: t("nav.inspection") }}
      />
    </Stack.Navigator>
  );
}

function MainTabs() {
  const { t } = useTranslation();
  // Lift the tab bar above the iOS home indicator / Android nav buttons.
  const insets = useSafeAreaInsets();
  const tabBarStyle = {
    backgroundColor: theme.colors.white,
    borderTopColor: theme.colors.border,
    height: 64 + insets.bottom,
    paddingTop: 8,
    paddingBottom: insets.bottom + 10,
  } as const;

  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.brand,
        tabBarInactiveTintColor: theme.colors.textLight,
        tabBarStyle,
        tabBarLabelStyle: { fontWeight: "700", fontSize: 11, marginTop: 2 },
      }}
    >
      <Tabs.Screen
        name="InspectTab"
        component={InspectStack}
        options={({ route }) => {
          // Hide the tab bar while the wizard ("Inspect") is focused so the
          // capture flow gets the full screen; show it on the Dashboard.
          const focused = getFocusedRouteNameFromRoute(route) ?? "Dashboard";
          return {
            tabBarLabel: t("nav.inspect"),
            tabBarIcon: makeTabIcon("clipboard-outline"),
            tabBarStyle: focused === "Inspect" ? { display: "none" } : tabBarStyle,
          };
        }}
      />
      <Tabs.Screen
        name="ProfileTab"
        component={ProfileScreen}
        options={{ tabBarLabel: t("nav.profile"), tabBarIcon: makeTabIcon("person-outline") }}
      />
    </Tabs.Navigator>
  );
}

function AuthStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: Platform.OS === "web" ? "none" : "default",
      }}
    >
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Register" component={RegisterScreen} />
    </Stack.Navigator>
  );
}

export function RootNavigator() {
  const { user, role, loading } = useAuth();
  if (loading) return null;

  // Block only a CONFIRMED non-staff role. While role is still null (unfetched
  // or a transient error) we fail-open so a real inspector is never locked out.
  const isStaff = role == null || STAFF_ROLES.includes(role);

  return (
    <NavigationContainer theme={navTheme}>
      {user ? (isStaff ? <MainTabs /> : <NotAuthorizedScreen />) : <AuthStack />}
    </NavigationContainer>
  );
}
