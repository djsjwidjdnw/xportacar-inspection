// The inspector app's reader of app_settings.bidding_enabled (same pattern as
// the buyer app). XportACar is a fixed-price marketplace: auction-only inputs
// (the reserve price) are shown only while this flag is on. Defaults to off.

import { useEffect, useState } from "react";
import { supabase } from "./supabase";

let cached: boolean | null = null;

export function useBiddingEnabled(): boolean {
  const [enabled, setEnabled] = useState<boolean>(cached ?? false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase
          .from("app_settings").select("value").eq("key", "bidding_enabled").maybeSingle();
        cached = (data as { value?: unknown } | null)?.value === true;
        if (alive) setEnabled(cached);
      } catch { /* keep the default: fixed price */ }
    })();
    return () => { alive = false; };
  }, []);
  return enabled;
}
