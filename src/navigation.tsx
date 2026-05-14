import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { LoginScreen as LoginScreenImpl } from "./screens/LoginScreen";
import { DashboardScreen as DashboardScreenImpl } from "./screens/DashboardScreen";
import { InspectionWizardScreen as InspectionWizardScreenImpl } from "./screens/InspectionWizardScreen";

import { useAuth } from "./lib/auth";
import { theme } from "./lib/theme";

const Stack = createNativeStackNavigator();

type AnyScreen = React.ComponentType<Record<string, unknown>>;
const LoginScreen          = LoginScreenImpl          as unknown as AnyScreen;
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
  const { user, loading } = useAuth();
  if (loading) return null;

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {user ? (
          <>
            <Stack.Screen name="Dashboard" component={DashboardScreen} />
            <Stack.Screen
              name="Inspect"
              component={InspectionWizard}
              options={{ headerShown: true, title: "Inspection" }}
            />
          </>
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
