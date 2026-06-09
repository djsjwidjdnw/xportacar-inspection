// React context wrapping the Supabase auth session.  Watches for changes
// and re-renders consumers when the user signs in / out.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

interface AuthValue {
  user: User | null;
  session: Session | null;
  /** profiles.role for the signed-in user, or null while unknown/unfetched. */
  role: string | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => subscription.subscription.unsubscribe();
  }, []);

  // Resolve the user's role so the navigator can restrict this internal tool to
  // staff. Best-effort: on any error role stays null and the navigator
  // fail-opens (RLS still blocks a non-staff user's writes at the database).
  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) { setRole(null); return; }
    let active = true;
    supabase
      .from("profiles")
      .select("role")
      .eq("id", uid)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setRole((data as { role?: string } | null)?.role ?? null);
      });
    return () => { active = false; };
  }, [session?.user?.id]);

  const value: AuthValue = {
    user: session?.user ?? null,
    session,
    role,
    loading,
    signOut: async () => { await supabase.auth.signOut(); },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
